use std::sync::Arc;
use async_trait::async_trait;
use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;

use crate::telemetry;
use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{HolidaySync, NewPublicHoliday, PublicHoliday};
use crate::schema::{holiday_syncs, public_holidays};
use super::domain::{HolidayDomain, HolidayRepository, HolidaySyncDomain};

#[derive(Clone)]
pub struct DieselHolidayRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl HolidayRepository for DieselHolidayRepository {
    async fn list_holidays(&self, tenant_id: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<HolidayDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let rows = public_holidays::table
                .filter(public_holidays::tenant_id.eq(&tenant_id))
                .filter(public_holidays::holiday_date.between(from, to))
                .order(public_holidays::holiday_date.asc())
                .load::<PublicHoliday>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(rows
                .into_iter()
                .map(|h| HolidayDomain { date: h.holiday_date, name: h.name, state: h.state })
                .collect())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn count_holidays(&self, tenant_id: &str, from: NaiveDate, to: NaiveDate, state: &str) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let state = state.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            public_holidays::table
                .filter(public_holidays::tenant_id.eq(&tenant_id))
                .filter(public_holidays::state.eq(&state))
                .filter(public_holidays::holiday_date.between(from, to))
                .count()
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn replace_holidays(&self, tenant_id: &str, from: NaiveDate, to: NaiveDate, holidays: Vec<HolidayDomain>) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, diesel::result::Error, _>(|conn| {
                diesel::delete(
                    public_holidays::table
                        .filter(public_holidays::tenant_id.eq(&tenant_id))
                        .filter(public_holidays::holiday_date.between(from, to)),
                )
                .execute(conn)?;
                let rows: Vec<NewPublicHoliday> = holidays
                    .into_iter()
                    .map(|h| NewPublicHoliday {
                        tenant_id: tenant_id.clone(),
                        holiday_date: h.date,
                        name: h.name,
                        state: h.state,
                    })
                    .collect();
                diesel::insert_into(public_holidays::table)
                    .values(&rows)
                    .on_conflict_do_nothing()
                    .execute(conn)?;
                Ok(())
            })
            .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_holiday_tenants(&self) -> Result<Vec<String>, AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            public_holidays::table
                .select(public_holidays::tenant_id)
                .distinct()
                .load::<String>(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_holiday_sync(&self, tenant_id: &str, year: i32, state: &str) -> Result<Option<HolidaySyncDomain>, AppError> {
        let (tenant_id, state) = (tenant_id.to_string(), state.to_string());
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let row = holiday_syncs::table
                .filter(holiday_syncs::tenant_id.eq(&tenant_id))
                .filter(holiday_syncs::year.eq(year))
                .filter(holiday_syncs::state.eq(&state))
                .first::<HolidaySync>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;
            Ok(row.map(|r| HolidaySyncDomain {
                last_synced_at: r.last_synced_at,
                last_attempt_at: r.last_attempt_at,
                consecutive_failures: r.consecutive_failures,
            }))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn record_holiday_sync(&self, tenant_id: &str, year: i32, state: &str, ok: bool, now: NaiveDateTime) -> Result<(), AppError> {
        let (tenant_id, state) = (tenant_id.to_string(), state.to_string());
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let insert = (
                holiday_syncs::tenant_id.eq(&tenant_id),
                holiday_syncs::year.eq(year),
                holiday_syncs::state.eq(&state),
                holiday_syncs::last_synced_at.eq(ok.then_some(now)),
                holiday_syncs::last_attempt_at.eq(now),
                holiday_syncs::consecutive_failures.eq(i32::from(!ok)),
            );
            let target = diesel::insert_into(holiday_syncs::table)
                .values(&insert)
                .on_conflict((holiday_syncs::tenant_id, holiday_syncs::year, holiday_syncs::state));
            if ok {
                target
                    .do_update()
                    .set((
                        holiday_syncs::last_synced_at.eq(Some(now)),
                        holiday_syncs::last_attempt_at.eq(now),
                        holiday_syncs::consecutive_failures.eq(0),
                    ))
                    .execute(&mut conn)
            } else {
                target
                    .do_update()
                    .set((
                        holiday_syncs::last_attempt_at.eq(now),
                        holiday_syncs::consecutive_failures.eq(holiday_syncs::consecutive_failures + 1),
                    ))
                    .execute(&mut conn)
            }
            .map(|_| ())
            .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn claim_holiday_sync(&self, tenant_id: &str, year: i32, state: &str, expected: Option<NaiveDateTime>, now: NaiveDateTime) -> Result<bool, AppError> {
        let (tenant_id, state) = (tenant_id.to_string(), state.to_string());
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let claimed = match expected {
                // Never tried: whoever inserts the row first wins.
                None => diesel::insert_into(holiday_syncs::table)
                    .values((
                        holiday_syncs::tenant_id.eq(&tenant_id),
                        holiday_syncs::year.eq(year),
                        holiday_syncs::state.eq(&state),
                        holiday_syncs::last_attempt_at.eq(now),
                        holiday_syncs::consecutive_failures.eq(0),
                    ))
                    .on_conflict_do_nothing()
                    .execute(&mut conn),
                // Tried before: move the attempt time only if nobody else has.
                Some(seen) => diesel::update(
                    holiday_syncs::table
                        .filter(holiday_syncs::tenant_id.eq(&tenant_id))
                        .filter(holiday_syncs::year.eq(year))
                        .filter(holiday_syncs::state.eq(&state))
                        .filter(holiday_syncs::last_attempt_at.eq(seen)),
                )
                .set(holiday_syncs::last_attempt_at.eq(now))
                .execute(&mut conn),
            }
            .map_err(|_| AppError::DbError)?;
            Ok(claimed == 1)
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
