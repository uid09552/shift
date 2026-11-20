use async_trait::async_trait;
use chrono::NaiveDate;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{self as models, NewOpenShift, OpenShift, OpenShiftVolunteer};
use crate::repository::domain::{open_shift_status, OpenShiftRepository};
use crate::repository::rostertracking;
use crate::schema::{confirmed_shift_plans, open_shift_volunteers, open_shifts};
use crate::services::roster_guard::RosterChangeCtx;
use crate::telemetry;

#[derive(Clone)]
pub struct DieselOpenShiftRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl OpenShiftRepository for DieselOpenShiftRepository {
    async fn create_open_shift(&self, tenant_id: &str, mut open_shift: NewOpenShift) -> Result<OpenShift, AppError> {
        open_shift.tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(open_shifts::table)
                .values(&open_shift)
                .get_result::<OpenShift>(&mut conn)
                .map_err(AppError::from)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_open_shift(&self, tenant_id: &str, id: Uuid) -> Result<Option<OpenShift>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            open_shifts::table
                .filter(open_shifts::id.eq(id))
                .filter(open_shifts::tenant_id.eq(&tenant_id))
                .first::<OpenShift>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn list_open_shifts(&self, tenant_id: &str, statuses: &[String], from: Option<NaiveDate>) -> Result<Vec<OpenShift>, AppError> {
        let tenant_id = tenant_id.to_string();
        let statuses = statuses.to_vec();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = open_shifts::table
                .filter(open_shifts::tenant_id.eq(&tenant_id))
                .order((open_shifts::date.asc(), open_shifts::created_at.asc()))
                .into_boxed();
            if !statuses.is_empty() {
                query = query.filter(open_shifts::status.eq_any(statuses));
            }
            if let Some(from) = from {
                query = query.filter(open_shifts::date.ge(from));
            }
            query.load::<OpenShift>(&mut conn).map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn count_open_shifts(&self, tenant_id: &str) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            open_shifts::table
                .filter(open_shifts::tenant_id.eq(&tenant_id))
                .filter(open_shifts::status.eq(open_shift_status::OPEN))
                .count()
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn list_volunteers(&self, tenant_id: &str, open_shift_ids: &[Uuid]) -> Result<Vec<OpenShiftVolunteer>, AppError> {
        let tenant_id = tenant_id.to_string();
        let ids = open_shift_ids.to_vec();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            // Through the offer, so another tenant's ids never match.
            open_shift_volunteers::table
                .inner_join(open_shifts::table)
                .filter(open_shifts::tenant_id.eq(&tenant_id))
                .filter(open_shift_volunteers::open_shift_id.eq_any(&ids))
                .order(open_shift_volunteers::created_at.asc())
                .select(open_shift_volunteers::all_columns)
                .load::<OpenShiftVolunteer>(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn add_volunteer(&self, tenant_id: &str, open_shift_id: Uuid, employee_id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                let offer = open_shifts::table
                    .filter(open_shifts::id.eq(open_shift_id))
                    .filter(open_shifts::tenant_id.eq(&tenant_id))
                    .for_share()
                    .first::<OpenShift>(conn)
                    .optional()?
                    .ok_or(AppError::NotFound)?;
                if offer.status != open_shift_status::OPEN {
                    return Err(AppError::Conflict(format!("This shift is already {}", offer.status)));
                }
                diesel::insert_into(open_shift_volunteers::table)
                    .values((
                        open_shift_volunteers::open_shift_id.eq(open_shift_id),
                        open_shift_volunteers::employee_id.eq(employee_id),
                    ))
                    .on_conflict_do_nothing()
                    .execute(conn)?;
                Ok(())
            })
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn remove_volunteer(&self, tenant_id: &str, open_shift_id: Uuid, employee_id: Uuid) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let own = open_shifts::table
                .filter(open_shifts::id.eq(open_shift_id))
                .filter(open_shifts::tenant_id.eq(&tenant_id))
                .select(open_shifts::id);
            diesel::delete(
                open_shift_volunteers::table
                    .filter(open_shift_volunteers::open_shift_id.eq_any(own))
                    .filter(open_shift_volunteers::employee_id.eq(employee_id)),
            )
            .execute(&mut conn)
            .map(|n| n > 0)
            .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn close_open_shift(&self, tenant_id: &str, id: Uuid, decided_by: Option<String>) -> Result<Option<OpenShift>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                open_shifts::table
                    .filter(open_shifts::id.eq(id))
                    .filter(open_shifts::tenant_id.eq(&tenant_id))
                    .filter(open_shifts::status.eq(open_shift_status::OPEN)),
            )
            .set((
                open_shifts::status.eq(open_shift_status::CLOSED),
                open_shifts::decided_by.eq(&decided_by),
                open_shifts::updated_at.eq(diesel::dsl::now),
            ))
            .get_result::<OpenShift>(&mut conn)
            .optional()
            .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn fill_open_shift(
        &self,
        tenant_id: &str,
        id: Uuid,
        employee_id: Uuid,
        decided_by: Option<String>,
        ctx: &RosterChangeCtx,
    ) -> Result<OpenShift, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        let ctx = ctx.clone();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                let offer = open_shifts::table
                    .filter(open_shifts::id.eq(id))
                    .filter(open_shifts::tenant_id.eq(&tenant_id))
                    .for_update()
                    .first::<OpenShift>(conn)
                    .optional()?
                    .ok_or(AppError::NotFound)?;
                if offer.status != open_shift_status::OPEN {
                    return Err(AppError::Conflict(format!("This shift is already {}", offer.status)));
                }

                rostertracking::guarded(conn, &tenant_id, &ctx, &[(employee_id, offer.date)], |conn| {
                    // One row per person and day: a planned day off makes way.
                    diesel::insert_into(confirmed_shift_plans::table)
                        .values(models::NewConfirmedShiftPlan {
                            employee_id,
                            shift_id: Some(offer.shift_id),
                            workstation_id: offer.workstation_id,
                            date: offer.date,
                            is_present: true,
                            absence_type: None,
                            creation_type: "manual".to_string(),
                            tenant_id: tenant_id.clone(),
                        })
                        .on_conflict((
                            confirmed_shift_plans::tenant_id,
                            confirmed_shift_plans::employee_id,
                            confirmed_shift_plans::date,
                        ))
                        .do_update()
                        .set((
                            confirmed_shift_plans::shift_id.eq(Some(offer.shift_id)),
                            confirmed_shift_plans::workstation_id.eq(offer.workstation_id),
                            confirmed_shift_plans::is_present.eq(true),
                            confirmed_shift_plans::absence_type.eq(None::<String>),
                            confirmed_shift_plans::creation_type.eq("manual"),
                            confirmed_shift_plans::updated_at.eq(diesel::dsl::now),
                        ))
                        .execute(conn)?;
                    Ok(())
                })?;

                Ok(diesel::update(open_shifts::table.filter(open_shifts::id.eq(id)))
                    .set((
                        open_shifts::status.eq(open_shift_status::FILLED),
                        open_shifts::assigned_employee_id.eq(Some(employee_id)),
                        open_shifts::decided_by.eq(&decided_by),
                        open_shifts::updated_at.eq(diesel::dsl::now),
                    ))
                    .get_result::<OpenShift>(conn)?)
            })
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}
