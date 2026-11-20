use async_trait::async_trait;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use std::collections::BTreeMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewOutboxMessage, NotificationPreference, OutboxMessage, RosterChangeNotice};
use crate::repository::domain::{NoticeDigest, NotificationRepository};
use crate::schema::{notification_outbox, notification_preferences, roster_change_notices, roster_notice_deliveries};
use crate::telemetry;

#[derive(Clone)]
pub struct DieselNotificationRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl NotificationRepository for DieselNotificationRepository {
    async fn get_preference(&self, tenant_id: &str, employee_id: Uuid) -> Result<Option<NotificationPreference>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            notification_preferences::table
                .filter(notification_preferences::employee_id.eq(employee_id))
                .filter(notification_preferences::tenant_id.eq(&tenant_id))
                .first::<NotificationPreference>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn preferences_for(&self, tenant_id: &str, employee_ids: &[Uuid]) -> Result<Vec<NotificationPreference>, AppError> {
        let tenant_id = tenant_id.to_string();
        let ids = employee_ids.to_vec();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            notification_preferences::table
                .filter(notification_preferences::tenant_id.eq(&tenant_id))
                .filter(notification_preferences::employee_id.eq_any(&ids))
                .load::<NotificationPreference>(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn save_preference(
        &self,
        tenant_id: &str,
        employee_id: Uuid,
        email_enabled: bool,
        muted_events: Vec<String>,
    ) -> Result<NotificationPreference, AppError> {
        let row = NotificationPreference {
            employee_id,
            tenant_id: tenant_id.to_string(),
            email_enabled,
            muted_events,
            updated_at: chrono::Utc::now().naive_utc(),
        };
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(notification_preferences::table)
                .values(&row)
                .on_conflict(notification_preferences::employee_id)
                .do_update()
                .set(&row)
                .get_result::<NotificationPreference>(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn enqueue(&self, messages: Vec<NewOutboxMessage>) -> Result<usize, AppError> {
        if messages.is_empty() {
            return Ok(0);
        }
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(notification_outbox::table)
                .values(&messages)
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn claim_due(&self, now: NaiveDateTime, limit: i64, lease: chrono::Duration) -> Result<Vec<OutboxMessage>, AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                // SKIP LOCKED: two instances never take the same message.
                let due: Vec<OutboxMessage> = notification_outbox::table
                    .filter(notification_outbox::status.eq("pending"))
                    .filter(notification_outbox::next_attempt_at.le(now))
                    .order(notification_outbox::created_at.asc())
                    .limit(limit)
                    .for_update()
                    .skip_locked()
                    .load(conn)?;
                let ids: Vec<Uuid> = due.iter().map(|m| m.id).collect();
                diesel::update(notification_outbox::table.filter(notification_outbox::id.eq_any(&ids)))
                    .set(notification_outbox::next_attempt_at.eq(now + lease))
                    .execute(conn)?;
                Ok(due)
            })
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn mark_sent(&self, id: Uuid, now: NaiveDateTime) -> Result<(), AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(notification_outbox::table.filter(notification_outbox::id.eq(id)))
                .set((
                    notification_outbox::status.eq("sent"),
                    notification_outbox::attempts.eq(notification_outbox::attempts + 1),
                    notification_outbox::sent_at.eq(Some(now)),
                    notification_outbox::last_error.eq(None::<String>),
                ))
                .execute(&mut conn)
                .map(|_| ())
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn mark_attempt_failed(&self, id: Uuid, error: &str, retry_at: Option<NaiveDateTime>) -> Result<(), AppError> {
        let error = error.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let target = notification_outbox::table.filter(notification_outbox::id.eq(id));
            match retry_at {
                Some(at) => diesel::update(target)
                    .set((
                        notification_outbox::attempts.eq(notification_outbox::attempts + 1),
                        notification_outbox::last_error.eq(Some(error)),
                        notification_outbox::next_attempt_at.eq(at),
                    ))
                    .execute(&mut conn),
                None => diesel::update(target)
                    .set((
                        notification_outbox::status.eq("failed"),
                        notification_outbox::attempts.eq(notification_outbox::attempts + 1),
                        notification_outbox::last_error.eq(Some(error)),
                    ))
                    .execute(&mut conn),
            }
            .map(|_| ())
            .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn sweep_roster_notices(&self, since: NaiveDateTime, limit: i64) -> Result<Vec<NoticeDigest>, AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                // A subquery rather than a join: FOR UPDATE may not lock the
                // nullable side of an outer join.
                let fresh: Vec<RosterChangeNotice> = roster_change_notices::table
                    .filter(roster_change_notices::id.ne_all(
                        roster_notice_deliveries::table.select(roster_notice_deliveries::notice_id),
                    ))
                    .order(roster_change_notices::created_at.asc())
                    .limit(limit)
                    .for_update()
                    .skip_locked()
                    .load(conn)?;
                if fresh.is_empty() {
                    return Ok(Vec::new());
                }
                // Everything swept is handled — the ones too old to announce included.
                let handled: Vec<_> = fresh
                    .iter()
                    .map(|n| roster_notice_deliveries::notice_id.eq(n.id))
                    .collect();
                diesel::insert_into(roster_notice_deliveries::table)
                    .values(&handled)
                    .on_conflict_do_nothing()
                    .execute(conn)?;

                let mut grouped: BTreeMap<(String, Uuid), Vec<RosterChangeNotice>> = BTreeMap::new();
                for notice in fresh.into_iter().filter(|n| n.created_at >= since) {
                    grouped.entry((notice.tenant_id.clone(), notice.employee_id)).or_default().push(notice);
                }
                Ok(grouped
                    .into_iter()
                    .map(|((tenant_id, employee_id), notices)| NoticeDigest { tenant_id, employee_id, notices })
                    .collect())
            })
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn list_outbox(&self, tenant_id: &str, limit: i64) -> Result<Vec<OutboxMessage>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            notification_outbox::table
                .filter(notification_outbox::tenant_id.eq(&tenant_id))
                .order(notification_outbox::created_at.desc())
                .limit(limit)
                .load::<OutboxMessage>(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}
