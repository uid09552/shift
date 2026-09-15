use async_trait::async_trait;
use diesel::prelude::*;
use diesel::result::Error as DieselError;
use std::sync::Arc;
use crate::telemetry;
use crate::errors::AppError;

use crate::database::DbPool;
use crate::repository::domain::{AuditFacetsDomain, AuditLogDomain, AuditLogFilter, AuditLogRepository};
use diesel::pg::Pg;
use crate::models as models;
use crate::schema::audit_logs;

/// Rolling per-tenant cap on stored audit log / notification rows. Oldest rows
/// beyond this count are trimmed on every insert so the table (and the UI's
/// notification bell, which reads straight from it) never grows unbounded.
const MAX_AUDIT_LOGS_PER_TENANT: i64 = 10_000;

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
        let tenant_id_for_trim = tenant_id.to_string();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction(|conn| {
                let inserted = diesel::insert_into(audit_logs::table)
                    .values(&new_log)
                    .get_result::<models::AuditLog>(conn)?;

                // Trim oldest rows beyond the per-tenant cap. Ordering by
                // created_at DESC and skipping the newest MAX rows leaves
                // exactly the excess (if any) as the delete target.
                let stale_ids = audit_logs::table
                    .filter(audit_logs::tenant_id.eq(&tenant_id_for_trim))
                    .order(audit_logs::created_at.desc())
                    .select(audit_logs::id)
                    .offset(MAX_AUDIT_LOGS_PER_TENANT)
                    .load::<uuid::Uuid>(conn)?;
                if !stale_ids.is_empty() {
                    diesel::delete(audit_logs::table.filter(audit_logs::id.eq_any(stale_ids)))
                        .execute(conn)?;
                }

                Ok(inserted)
            })
            .map(to_domain)
            .map_err(|_: DieselError| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_audit_logs(
        &self,
        tenant_id: &str,
        filter: AuditLogFilter,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<AuditLogDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = filtered(&tenant_id, &filter).order(audit_logs::created_at.desc());
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

    async fn count_audit_logs(&self, tenant_id: &str, filter: AuditLogFilter) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            filtered(&tenant_id, &filter).count().first(&mut conn).map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn audit_facets(&self, tenant_id: &str) -> Result<AuditFacetsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let of_tenant = || audit_logs::table.filter(audit_logs::tenant_id.eq(&tenant_id));
            let actions = of_tenant()
                .select(audit_logs::action)
                .distinct()
                .order(audit_logs::action.asc())
                .load::<String>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            let entity_types = of_tenant()
                .select(audit_logs::entity_type)
                .filter(audit_logs::entity_type.is_not_null())
                .distinct()
                .order(audit_logs::entity_type.asc())
                .load::<Option<String>>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            let actors = of_tenant()
                .select(audit_logs::actor)
                .filter(audit_logs::actor.is_not_null())
                .distinct()
                .order(audit_logs::actor.asc())
                .load::<Option<String>>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(AuditFacetsDomain {
                actions,
                entity_types: entity_types.into_iter().flatten().collect(),
                actors: actors.into_iter().flatten().collect(),
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

/// The tenant's audit entries narrowed by `filter` — shared by list and count
/// so the page's "N of M" always describes the rows it shows.
fn filtered<'a>(tenant_id: &'a str, filter: &'a AuditLogFilter) -> audit_logs::BoxedQuery<'a, Pg> {
    let mut query = audit_logs::table.filter(audit_logs::tenant_id.eq(tenant_id)).into_boxed();
    if let Some(a) = &filter.action {
        query = query.filter(audit_logs::action.eq(a));
    }
    if let Some(et) = &filter.entity_type {
        query = query.filter(audit_logs::entity_type.eq(et));
    }
    if let Some(id) = &filter.entity_id {
        query = query.filter(audit_logs::entity_id.eq(id));
    }
    if let Some(actor) = &filter.actor {
        // The user's text is matched literally: % and _ mean themselves.
        let escaped = actor.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        query = query.filter(audit_logs::actor.ilike(format!("%{escaped}%")));
    }
    if let Some(from) = filter.from_date {
        query = query.filter(audit_logs::created_at.ge(from));
    }
    if let Some(to) = filter.to_date {
        query = query.filter(audit_logs::created_at.le(to));
    }
    query
}
