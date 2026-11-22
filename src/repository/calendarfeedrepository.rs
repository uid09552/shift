use async_trait::async_trait;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::repository::domain::{CalendarFeedDomain, CalendarFeedRepository};
use crate::schema::calendar_feeds;
use crate::telemetry;

type Row = (Uuid, String, NaiveDateTime, Option<NaiveDateTime>);

const COLUMNS: (calendar_feeds::employee_id, calendar_feeds::tenant_id, calendar_feeds::created_at, calendar_feeds::last_fetched_at) = (
    calendar_feeds::employee_id,
    calendar_feeds::tenant_id,
    calendar_feeds::created_at,
    calendar_feeds::last_fetched_at,
);

fn to_domain((employee_id, tenant_id, created_at, last_fetched_at): Row) -> CalendarFeedDomain {
    CalendarFeedDomain { employee_id, tenant_id, created_at, last_fetched_at }
}

#[derive(Clone)]
pub struct DieselCalendarFeedRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl CalendarFeedRepository for DieselCalendarFeedRepository {
    async fn get_feed(&self, tenant_id: &str, employee_id: Uuid) -> Result<Option<CalendarFeedDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            calendar_feeds::table
                .filter(calendar_feeds::employee_id.eq(employee_id))
                .filter(calendar_feeds::tenant_id.eq(&tenant_id))
                .select(COLUMNS)
                .first::<Row>(&mut conn)
                .optional()
                .map(|r| r.map(to_domain))
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn replace_feed(&self, tenant_id: &str, employee_id: Uuid, token_hash: &str) -> Result<CalendarFeedDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let token_hash = token_hash.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(calendar_feeds::table)
                .values((
                    calendar_feeds::employee_id.eq(employee_id),
                    calendar_feeds::tenant_id.eq(&tenant_id),
                    calendar_feeds::token_hash.eq(&token_hash),
                ))
                .on_conflict(calendar_feeds::employee_id)
                .do_update()
                .set((
                    calendar_feeds::token_hash.eq(&token_hash),
                    calendar_feeds::created_at.eq(diesel::dsl::now),
                    calendar_feeds::last_fetched_at.eq(None::<NaiveDateTime>),
                ))
                .returning(COLUMNS)
                .get_result::<Row>(&mut conn)
                .map(to_domain)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn delete_feed(&self, tenant_id: &str, employee_id: Uuid) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                calendar_feeds::table
                    .filter(calendar_feeds::employee_id.eq(employee_id))
                    .filter(calendar_feeds::tenant_id.eq(&tenant_id)),
            )
            .execute(&mut conn)
            .map(|n| n > 0)
            .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn touch_feed_by_hash(&self, token_hash: &str) -> Result<Option<CalendarFeedDomain>, AppError> {
        let token_hash = token_hash.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(calendar_feeds::table.filter(calendar_feeds::token_hash.eq(&token_hash)))
                .set(calendar_feeds::last_fetched_at.eq(Some(chrono::Utc::now().naive_utc())))
                .returning(COLUMNS)
                .get_result::<Row>(&mut conn)
                .optional()
                .map(|r| r.map(to_domain))
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}
