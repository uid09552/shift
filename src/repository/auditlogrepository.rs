use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use tokio::task;
use crate::errors::AppError;

use crate::database::DbPool;
use crate::repository::domain::{AuditLogDomain, AuditLogRepository};
use crate::models as models;
use crate::schema::audit_logs;

#[derive(Clone)]
pub struct DieselAuditLogRepository {
    pub pool: Arc<DbPool>,
}

fn to_domain(r: models::AuditLog) -> AuditLogDomain {
    AuditLogDomain {
        id: r.id,
        actor: r.actor,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        changes: r.changes,
        created_at: r.created_at,
    }
}

#[async_trait]
impl AuditLogRepository for DieselAuditLogRepository {
    async fn create_audit_log(
        &self,
        tenant_id: &str,
        actor: Option<String>,
        action: &str,
        entity_type: Option<&str>,
        entity_id: Option<String>,
        changes: Option<String>,
    ) -> Result<AuditLogDomain, AppError> {
        let pool = Arc::clone(&self.pool);
        let new_log = models::NewAuditLog {
            tenant_id: tenant_id.to_string(),
            actor,
            action: action.to_string(),
            entity_type: entity_type.map(|s| s.to_string()),
            entity_id,
            changes,
        };
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(audit_logs::table)
                .values(&new_log)
                .get_result::<models::AuditLog>(&mut conn)
                .map(to_domain)
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_audit_logs(
        &self,
        tenant_id: &str,
        action: Option<&str>,
        entity_type: Option<&str>,
        from_date: Option<chrono::NaiveDateTime>,
        to_date: Option<chrono::NaiveDateTime>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<AuditLogDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let action = action.map(|s| s.to_string());
        let entity_type = entity_type.map(|s| s.to_string());
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = audit_logs::table
                .filter(audit_logs::tenant_id.eq(tenant_id))
                .order(audit_logs::created_at.desc())
                .into_boxed();
            if let Some(a) = action {
                query = query.filter(audit_logs::action.eq(a));
            }
            if let Some(et) = entity_type {
                query = query.filter(audit_logs::entity_type.eq(et));
            }
            if let Some(from) = from_date {
                query = query.filter(audit_logs::created_at.ge(from));
            }
            if let Some(to) = to_date {
                query = query.filter(audit_logs::created_at.le(to));
            }
            if let Some(l) = limit {
                query = query.limit(l);
            }
            if let Some(o) = offset {
                query = query.offset(o);
            }
            query
                .load::<models::AuditLog>(&mut conn)
                .map(|rows| rows.into_iter().map(to_domain).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn count_audit_logs(
        &self,
        tenant_id: &str,
        action: Option<&str>,
        entity_type: Option<&str>,
        from_date: Option<chrono::NaiveDateTime>,
        to_date: Option<chrono::NaiveDateTime>,
    ) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let action = action.map(|s| s.to_string());
        let entity_type = entity_type.map(|s| s.to_string());
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = audit_logs::table
                .filter(audit_logs::tenant_id.eq(tenant_id))
                .into_boxed();
            if let Some(a) = action {
                query = query.filter(audit_logs::action.eq(a));
            }
            if let Some(et) = entity_type {
                query = query.filter(audit_logs::entity_type.eq(et));
            }
            if let Some(from) = from_date {
                query = query.filter(audit_logs::created_at.ge(from));
            }
            if let Some(to) = to_date {
                query = query.filter(audit_logs::created_at.le(to));
            }
            query.count().first(&mut conn).map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
