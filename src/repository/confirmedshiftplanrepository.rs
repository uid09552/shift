use async_trait::async_trait;
use chrono::NaiveDate;
use chrono::Utc;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;
use crate::telemetry;
use crate::errors::AppError;
use diesel::pg::upsert::excluded;

use crate::database::DbPool;
use crate::repository::domain::{
    ConfirmedShiftPlan, ConfirmedShiftPlanRepository, MonthStatus,
};
use crate::repository::rostertracking::{self, Cell};
use crate::services::roster_guard::{RosterChangeCtx, WriteMode};
use crate::models::NewConfirmedShiftPlan;
use crate::models::UpdateConfirmedShiftPlan;
use crate::models as models;
use crate::schema::confirmed_shift_plans;

#[derive(Clone)]
pub struct DieselConfirmedShiftPlanRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl ConfirmedShiftPlanRepository for DieselConfirmedShiftPlanRepository {
    async fn create_confirmed_shift_plan(
        &self,
        tenant_id: &str,
        plan: ConfirmedShiftPlan,
        ctx: &RosterChangeCtx,
    ) -> Result<ConfirmedShiftPlan, AppError> {
        let pool = Arc::clone(&self.pool);
        let tenant = tenant_id.to_string();
        let ctx = ctx.clone();
        let new_plan = NewConfirmedShiftPlan {
            employee_id: plan.employee_id,
            shift_id: plan.shift_id,
            workstation_id: plan.workstation_id,
            date: plan.date,
            is_present: plan.is_present,
            absence_type: plan.absence_type.clone(),
            creation_type: plan.creation_type.clone(),
            tenant_id: tenant_id.to_string(),
        };
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let cell = (new_plan.employee_id, new_plan.date);
            rostertracking::guarded(&mut conn, &tenant, &ctx, &[cell], |conn| {
            // Upsert: if a plan already exists for (tenant_id, employee_id, date), update it
            // so that marking a day as leave never conflicts with an existing entry.
            let created = diesel::insert_into(confirmed_shift_plans::table)
                .values(&new_plan)
                .on_conflict((confirmed_shift_plans::tenant_id, confirmed_shift_plans::employee_id, confirmed_shift_plans::date))
                .do_update()
                .set((
                    confirmed_shift_plans::shift_id.eq(excluded(confirmed_shift_plans::shift_id)),
                    confirmed_shift_plans::workstation_id.eq(excluded(confirmed_shift_plans::workstation_id)),
                    confirmed_shift_plans::is_present.eq(excluded(confirmed_shift_plans::is_present)),
                    confirmed_shift_plans::absence_type.eq(excluded(confirmed_shift_plans::absence_type)),
                    confirmed_shift_plans::creation_type.eq(excluded(confirmed_shift_plans::creation_type)),
                    confirmed_shift_plans::updated_at.eq(diesel::dsl::now),
                ))
                .get_result::<models::ConfirmedShiftPlan>(conn)
                .map(to_domain)
                .map_err(|_| AppError::DbError)?;
            Ok(created)
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_confirmed_shift_plans_for_employee(
        &self,
        tenant_id: &str,
        employee_id: Uuid,
        published_only: bool,
    ) -> Result<Vec<ConfirmedShiftPlan>, AppError> {
        let filter = ReadFilter { employee_id: Some(employee_id), published_only, ..ReadFilter::new(tenant_id) };
        self.load(filter).await
    }

    async fn get_confirmed_shift_plans_for_employee_in_range(
        &self,
        tenant_id: &str,
        employee_id: Uuid,
        from_date: NaiveDate,
        to_date: NaiveDate,
        published_only: bool,
    ) -> Result<Vec<ConfirmedShiftPlan>, AppError> {
        let filter = ReadFilter {
            employee_id: Some(employee_id),
            range: Some((from_date, to_date)),
            published_only,
            ..ReadFilter::new(tenant_id)
        };
        self.load(filter).await
    }

    async fn get_confirmed_shift_plan_by_id(
        &self,
        tenant_id: &str,
        id: Uuid,
        published_only: bool,
    ) -> Result<Option<ConfirmedShiftPlan>, AppError> {
        let filter = ReadFilter { id: Some(id), published_only, ..ReadFilter::new(tenant_id) };
        Ok(self.load(filter).await?.into_iter().next())
    }

    async fn update_confirmed_shift_plan(
        &self,
        tenant_id: &str,
        id: Uuid,
        shift_id: Option<Option<Uuid>>,
        workstation_id: Option<Option<Uuid>>,
        is_present: Option<bool>,
        absence_type: Option<String>,
        creation_type: Option<String>,
        ctx: &RosterChangeCtx,
    ) -> Result<ConfirmedShiftPlan, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        let ctx = ctx.clone();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let cell = row_cell(&mut conn, &tenant_id, id)?;
            rostertracking::guarded(&mut conn, &tenant_id, &ctx, &[cell], |conn| {
            let update = UpdateConfirmedShiftPlan {
                shift_id,
                workstation_id,
                is_present,
                absence_type,
                creation_type,
                updated_at: Utc::now().naive_utc(),
            };
            let updated = diesel::update(
                confirmed_shift_plans::table
                    .filter(confirmed_shift_plans::id.eq(id))
                    .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id)),
            )
                .set(&update)
                .get_result::<models::ConfirmedShiftPlan>(conn)
                .map(to_domain)
                .map_err(|_| AppError::DbError)?;
            Ok(updated)
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_confirmed_shift_plan(
        &self,
        tenant_id: &str,
        id: Uuid,
        ctx: &RosterChangeCtx,
    ) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        let ctx = ctx.clone();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let cell = row_cell(&mut conn, &tenant_id, id)?;
            rostertracking::guarded(&mut conn, &tenant_id, &ctx, &[cell], |conn| {
            let count = diesel::delete(
                confirmed_shift_plans::table
                    .filter(confirmed_shift_plans::id.eq(id))
                    .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id)),
            )
                .execute(conn)
                .map_err(|_| AppError::DbError)?;
            if count == 0 {
                return Err(AppError::NotFound);
            }
            Ok(())
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_confirmed_shift_plans_for_employee_date_type(
        &self,
        tenant_id: &str,
        employee_id: Uuid,
        date: NaiveDate,
        absence_type: &str,
        ctx: &RosterChangeCtx,
    ) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        let absence_type = absence_type.to_owned();
        let ctx = ctx.clone();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            rostertracking::guarded(&mut conn, &tenant_id, &ctx, &[(employee_id, date)], |conn| {
            diesel::delete(
                confirmed_shift_plans::table
                    .filter(confirmed_shift_plans::employee_id.eq(employee_id))
                    .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                    .filter(confirmed_shift_plans::date.eq(date))
                    .filter(confirmed_shift_plans::absence_type.eq(Some(absence_type))),
            )
            .execute(conn)
            .map_err(|_| AppError::DbError)?;
            Ok(())
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_confirmed_shift_plans(
        &self,
        tenant_id: &str,
        limit: Option<i64>,
        offset: Option<i64>,
        published_only: bool,
    ) -> Result<Vec<ConfirmedShiftPlan>, AppError> {
        self.load(ReadFilter { limit, offset, published_only, ..ReadFilter::new(tenant_id) }).await
    }

    async fn count_confirmed_shift_plans(
        &self,
        tenant_id: &str,
        published_only: bool,
    ) -> Result<i64, AppError> {
        self.count(ReadFilter { published_only, ..ReadFilter::new(tenant_id) }).await
    }

    async fn get_confirmed_shift_plans_for_date_range(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
        limit: Option<i64>,
        offset: Option<i64>,
        published_only: bool,
    ) -> Result<Vec<ConfirmedShiftPlan>, AppError> {
        let filter = ReadFilter { range: Some((from_date, to_date)), limit, offset, published_only, ..ReadFilter::new(tenant_id) };
        self.load(filter).await
    }

    async fn count_confirmed_shift_plans_for_date_range(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
        published_only: bool,
    ) -> Result<i64, AppError> {
        self.count(ReadFilter { range: Some((from_date, to_date)), published_only, ..ReadFilter::new(tenant_id) }).await
    }

    async fn replace_confirmed_shift_plans_for_period(
        &self,
        tenant_id: &str,
        employee_ids: &[Uuid],
        from_date: NaiveDate,
        to_date: NaiveDate,
        new_plans: Vec<ConfirmedShiftPlan>,
        ctx: &RosterChangeCtx,
    ) -> Result<Vec<ConfirmedShiftPlan>, AppError> {
        let tenant_id = tenant_id.to_string();
        let employee_ids = employee_ids.to_vec();
        let pool = Arc::clone(&self.pool);
        let ctx = ctx.clone();
        let inserts = new_rows(&tenant_id, new_plans);

        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let cells = period_cells_with(&employee_ids, from_date, to_date, &inserts);
            rostertracking::guarded(&mut conn, &tenant_id, &ctx, &cells, |conn| {
                diesel::delete(
                    confirmed_shift_plans::table
                        .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                        .filter(confirmed_shift_plans::employee_id.eq_any(&employee_ids))
                        .filter(confirmed_shift_plans::date.ge(from_date))
                        .filter(confirmed_shift_plans::date.le(to_date)),
                )
                .execute(conn)
                .map_err(|_| AppError::DbError)?;

                if inserts.is_empty() {
                    return Ok(vec![]);
                }

                diesel::insert_into(confirmed_shift_plans::table)
                    .values(&inserts)
                    .on_conflict((confirmed_shift_plans::tenant_id, confirmed_shift_plans::employee_id, confirmed_shift_plans::date))
                    .do_update()
                    .set((
                        confirmed_shift_plans::shift_id.eq(excluded(confirmed_shift_plans::shift_id)),
                        confirmed_shift_plans::workstation_id.eq(excluded(confirmed_shift_plans::workstation_id)),
                        confirmed_shift_plans::is_present.eq(excluded(confirmed_shift_plans::is_present)),
                        confirmed_shift_plans::absence_type.eq(excluded(confirmed_shift_plans::absence_type)),
                        confirmed_shift_plans::creation_type.eq(excluded(confirmed_shift_plans::creation_type)),
                        confirmed_shift_plans::updated_at.eq(diesel::dsl::now),
                    ))
                    .get_results::<models::ConfirmedShiftPlan>(conn)
                    .map(|rows| rows.into_iter().map(to_domain).collect())
                    .map_err(|_| AppError::DbError)
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn count_period_changes(
        &self,
        tenant_id: &str,
        employee_ids: &[Uuid],
        from_date: NaiveDate,
        to_date: NaiveDate,
        new_plans: &[ConfirmedShiftPlan],
        today: NaiveDate,
    ) -> Result<usize, AppError> {
        let tenant_id = tenant_id.to_string();
        let employee_ids = employee_ids.to_vec();
        let pool = Arc::clone(&self.pool);
        let inserts = new_rows(&tenant_id, new_plans.to_vec());
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let cells = period_cells_with(&employee_ids, from_date, to_date, &inserts);
            let dates = cells.iter().map(|c| c.1).collect();
            let statuses = rostertracking::month_statuses(&mut conn, &tenant_id, &dates, today)?;
            let tracked: Vec<Cell> = cells
                .into_iter()
                .filter(|(_, date)| {
                    let month = crate::repository::domain::month_start(*date);
                    statuses.iter().any(|(m, s)| *m == month && *s != MonthStatus::Draft)
                })
                .collect();
            let before = rostertracking::snapshot(&mut conn, &tenant_id, &tracked)?;
            let after = inserts
                .iter()
                .map(|p| {
                    (
                        (p.employee_id, p.date),
                        crate::repository::domain::RosterEntry {
                            shift_id: p.shift_id,
                            workstation_id: p.workstation_id,
                            absence_type: p.absence_type.clone(),
                        },
                    )
                })
                .filter(|(cell, _)| tracked.contains(cell))
                .collect();
            Ok(rostertracking::changed_cells(&tracked, &before, &after).count())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn check_roster_write(&self, tenant_id: &str, ctx: &RosterChangeCtx, cells: &[(Uuid, NaiveDate)]) -> Result<WriteMode, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        let ctx = ctx.clone();
        let cells = cells.to_vec();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            rostertracking::check(&mut conn, &tenant_id, &ctx, &cells)
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

/// What a read of the roster selects. `published_only` drops rows in months
/// that are not published or locked — what a `shift-viewer` may see.
struct ReadFilter {
    tenant_id: String,
    id: Option<Uuid>,
    employee_id: Option<Uuid>,
    range: Option<(NaiveDate, NaiveDate)>,
    limit: Option<i64>,
    offset: Option<i64>,
    published_only: bool,
}

impl ReadFilter {
    fn new(tenant_id: &str) -> Self {
        Self { tenant_id: tenant_id.to_string(), id: None, employee_id: None, range: None, limit: None, offset: None, published_only: false }
    }

    fn query(&self) -> confirmed_shift_plans::BoxedQuery<'static, diesel::pg::Pg> {
        let mut query = confirmed_shift_plans::table
            .filter(confirmed_shift_plans::tenant_id.eq(self.tenant_id.clone()))
            .into_boxed();
        if let Some(id) = self.id {
            query = query.filter(confirmed_shift_plans::id.eq(id));
        }
        if let Some(employee_id) = self.employee_id {
            query = query.filter(confirmed_shift_plans::employee_id.eq(employee_id));
        }
        if let Some((from, to)) = self.range {
            query = query.filter(confirmed_shift_plans::date.between(from, to));
        }
        if self.published_only {
            // A month is visible once its stored status is published or locked;
            // the effective status only ever turns published into locked.
            query = query.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(
                "EXISTS (SELECT 1 FROM roster_months rm \
                 WHERE rm.tenant_id = confirmed_shift_plans.tenant_id \
                 AND rm.month = date_trunc('month', confirmed_shift_plans.date)::date \
                 AND rm.status <> 'draft')",
            ));
        }
        query
    }
}

impl DieselConfirmedShiftPlanRepository {
    async fn load(&self, filter: ReadFilter) -> Result<Vec<ConfirmedShiftPlan>, AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = filter.query().order(confirmed_shift_plans::date.asc());
            if let Some(l) = filter.limit {
                query = query.limit(l);
            }
            if let Some(o) = filter.offset {
                query = query.offset(o);
            }
            query
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map(|rows| rows.into_iter().map(to_domain).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn count(&self, filter: ReadFilter) -> Result<i64, AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            filter.query().count().get_result(&mut conn).map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

fn to_domain(p: models::ConfirmedShiftPlan) -> ConfirmedShiftPlan {
    ConfirmedShiftPlan {
        id: p.id,
        employee_id: p.employee_id,
        shift_id: p.shift_id,
        workstation_id: p.workstation_id,
        date: p.date,
        is_present: p.is_present,
        absence_type: p.absence_type,
        creation_type: p.creation_type,
        created_at: p.created_at,
        updated_at: p.updated_at,
    }
}

fn new_rows(tenant_id: &str, plans: Vec<ConfirmedShiftPlan>) -> Vec<models::NewConfirmedShiftPlan> {
    plans
        .into_iter()
        .map(|p| models::NewConfirmedShiftPlan {
            employee_id: p.employee_id,
            shift_id: p.shift_id,
            workstation_id: p.workstation_id,
            date: p.date,
            is_present: p.is_present,
            absence_type: p.absence_type,
            creation_type: p.creation_type,
            tenant_id: tenant_id.to_string(),
        })
        .collect()
}

/// Every employee-day of the period, plus any row to insert outside it.
fn period_cells_with(employee_ids: &[Uuid], from: NaiveDate, to: NaiveDate, inserts: &[models::NewConfirmedShiftPlan]) -> Vec<Cell> {
    let mut cells = rostertracking::period_cells(employee_ids, from, to);
    for p in inserts {
        if !cells.contains(&(p.employee_id, p.date)) {
            cells.push((p.employee_id, p.date));
        }
    }
    cells
}

/// The employee-day of a roster row; `NotFound` when it does not exist.
fn row_cell(conn: &mut PgConnection, tenant_id: &str, id: Uuid) -> Result<Cell, AppError> {
    confirmed_shift_plans::table
        .filter(confirmed_shift_plans::id.eq(id))
        .filter(confirmed_shift_plans::tenant_id.eq(tenant_id))
        .select((confirmed_shift_plans::employee_id, confirmed_shift_plans::date))
        .first(conn)
        .optional()?
        .ok_or(AppError::NotFound)
}
