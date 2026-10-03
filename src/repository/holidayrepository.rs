use std::sync::Arc;
use async_trait::async_trait;
use chrono::NaiveDate;
use diesel::prelude::*;

use crate::telemetry;
use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewPublicHoliday, PublicHoliday};
use crate::schema::public_holidays;
use super::domain::{HolidayDomain, HolidayRepository};

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
}
