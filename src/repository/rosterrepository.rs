use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models as models;
use crate::repository::domain::{
    effective_status, month_start, ChangeSource, MonthStatus, NoticeFilter, RosterChangeNotice,
    RosterChangeNoticeRepository, RosterEntry, RosterMonth, RosterMonthRepository, RosterMonthTransition,
};
use crate::schema::{roster_change_notices, roster_months};
use crate::telemetry;

pub(crate) fn month_to_domain(m: models::RosterMonth) -> RosterMonth {
    RosterMonth {
        month: m.month,
        status: MonthStatus::from_db(&m.status),
        published_at: m.published_at,
        published_by: m.published_by,
        locked_at: m.locked_at,
        locked_by: m.locked_by,
        reopened: m.reopened,
        updated_at: m.updated_at,
    }
}

fn entry_from_json(value: Option<serde_json::Value>) -> Option<RosterEntry> {
    value.and_then(|v| serde_json::from_value(v).ok())
}

fn notice_to_domain(n: models::RosterChangeNotice) -> RosterChangeNotice {
    RosterChangeNotice {
        id: n.id,
        employee_id: n.employee_id,
        date: n.date,
        before: entry_from_json(n.before),
        after: entry_from_json(n.after),
        source: ChangeSource::from_db(&n.source),
        actor: n.actor,
        reason: n.reason,
        created_at: n.created_at,
        acknowledged_at: n.acknowledged_at,
    }
}

#[derive(Clone)]
pub struct DieselRosterMonthRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl RosterMonthRepository for DieselRosterMonthRepository {
    async fn list_roster_months(&self, tenant_id: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<RosterMonth>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let rows = roster_months::table
                .filter(roster_months::tenant_id.eq(&tenant_id))
                .filter(roster_months::month.between(month_start(from), month_start(to)))
                .order(roster_months::month.asc())
                .load::<models::RosterMonth>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(rows.into_iter().map(month_to_domain).collect())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn transition_roster_month(&self, tenant_id: &str, change: RosterMonthTransition, today: NaiveDate) -> Result<Option<RosterMonth>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                let month = month_start(change.month);
                let current = roster_months::table
                    .filter(roster_months::tenant_id.eq(&tenant_id))
                    .filter(roster_months::month.eq(month))
                    .for_update()
                    .first::<models::RosterMonth>(conn)
                    .optional()?;
                let effective = effective_status(current.clone().map(month_to_domain).as_ref(), month, today);
                if !change.from.contains(&effective) {
                    return Ok(None);
                }

                let now = Utc::now().naive_utc();
                let mut row = current.unwrap_or(models::RosterMonth {
                    tenant_id: tenant_id.clone(),
                    month,
                    status: MonthStatus::Draft.as_str().to_string(),
                    published_at: None,
                    published_by: None,
                    locked_at: None,
                    locked_by: None,
                    reopened: false,
                    updated_at: now,
                });
                match change.to {
                    MonthStatus::Published if effective == MonthStatus::Draft => {
                        row.published_at = Some(now);
                        row.published_by = change.actor.clone();
                    }
                    MonthStatus::Locked => {
                        row.locked_at = Some(now);
                        row.locked_by = change.actor.clone();
                    }
                    _ => {}
                }
                row.status = change.to.as_str().to_string();
                row.reopened = change.reopened;
                row.updated_at = now;

                let saved = diesel::insert_into(roster_months::table)
                    .values(&row)
                    .on_conflict((roster_months::tenant_id, roster_months::month))
                    .do_update()
                    .set(&row)
                    .get_result::<models::RosterMonth>(conn)?;
                Ok(Some(month_to_domain(saved)))
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

#[derive(Clone)]
pub struct DieselRosterChangeNoticeRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl RosterChangeNoticeRepository for DieselRosterChangeNoticeRepository {
    async fn list_notices(&self, tenant_id: &str, filter: NoticeFilter) -> Result<Vec<RosterChangeNotice>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = roster_change_notices::table
                .filter(roster_change_notices::tenant_id.eq(&tenant_id))
                .into_boxed();
            if let Some(employee_id) = filter.employee_id {
                query = query.filter(roster_change_notices::employee_id.eq(employee_id));
            }
            if let Some(from) = filter.from_date {
                query = query.filter(roster_change_notices::date.ge(from));
            }
            if let Some(to) = filter.to_date {
                query = query.filter(roster_change_notices::date.le(to));
            }
            match filter.acknowledged {
                Some(true) => query = query.filter(roster_change_notices::acknowledged_at.is_not_null()),
                Some(false) => query = query.filter(roster_change_notices::acknowledged_at.is_null()),
                None => {}
            }
            let rows = query
                .order((roster_change_notices::created_at.desc(), roster_change_notices::date.asc()))
                .load::<models::RosterChangeNotice>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(rows.into_iter().map(notice_to_domain).collect())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn count_unacknowledged(&self, tenant_id: &str, employee_id: Uuid) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            roster_change_notices::table
                .filter(roster_change_notices::tenant_id.eq(&tenant_id))
                .filter(roster_change_notices::employee_id.eq(employee_id))
                .filter(roster_change_notices::acknowledged_at.is_null())
                .count()
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn acknowledge_notices(&self, tenant_id: &str, employee_id: Uuid, ids: Option<Vec<Uuid>>) -> Result<usize, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                let mut query = diesel::update(roster_change_notices::table)
                    .filter(roster_change_notices::tenant_id.eq(&tenant_id))
                    .filter(roster_change_notices::employee_id.eq(employee_id))
                    .filter(roster_change_notices::acknowledged_at.is_null())
                    .into_boxed();
                if let Some(ids) = &ids {
                    let foreign: i64 = roster_change_notices::table
                        .filter(roster_change_notices::tenant_id.eq(&tenant_id))
                        .filter(roster_change_notices::id.eq_any(ids))
                        .filter(roster_change_notices::employee_id.ne(employee_id))
                        .count()
                        .get_result(conn)?;
                    if foreign > 0 {
                        return Err(AppError::Forbidden("Only the employee a notice is about may acknowledge it".into()));
                    }
                    query = query.filter(roster_change_notices::id.eq_any(ids));
                }
                Ok(query
                    .set(roster_change_notices::acknowledged_at.eq(Utc::now().naive_utc()))
                    .execute(conn)?)
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
