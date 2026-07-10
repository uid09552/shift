use async_trait::async_trait;
use axum::{
    extract::{FromRequestParts, Query, State},
    http::request::Parts,
    Json,
};
use base64::{engine::general_purpose, Engine as _};
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::convert::Infallible;

use crate::errors::AppError;
use crate::repository::domain::AuditLogRepository;
use crate::repository::AppState;
use crate::services::auth::UserInfo;
use crate::services::tenant::TenantContext;

/// Best-effort identity of the caller, decoded from the same `X-Userinfo` header APISIX's
/// openid-connect plugin sets (see `crate::services::auth::get_self`). Resolves to `None`
/// when the header is absent/unparseable (e.g. local dev without the gateway in front),
/// so audit logging never blocks a request on missing auth.
pub struct AuditActor(pub Option<String>);

#[async_trait]
impl<S> FromRequestParts<S> for AuditActor
where
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let actor = parts
            .headers
            .get("x-userinfo")
            .and_then(|v| v.to_str().ok())
            .and_then(|raw| {
                general_purpose::STANDARD
                    .decode(raw)
                    .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(raw))
                    .ok()
            })
            .and_then(|bytes| serde_json::from_slice::<UserInfo>(&bytes).ok())
            .and_then(|info| info.preferred_username.or(info.email).or(info.sub));
        Ok(AuditActor(actor))
    }
}

/// Records an audit log entry. Best-effort: failures are logged to stderr and never
/// propagate, so a broken audit store can't take down the operation it's recording.
pub async fn record(
    state: &AppState,
    tenant_id: &str,
    actor: Option<String>,
    action: &str,
    entity_type: &str,
    entity_id: Option<String>,
    changes: Option<String>,
) {
    if let Err(e) = state
        .audit_log_repo
        .create_audit_log(tenant_id, actor, action, Some(entity_type), entity_id, changes)
        .await
    {
        eprintln!("Failed to record audit log for action '{}': {}", action, e);
    }
}

#[derive(Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Deserialize)]
pub struct ListAuditLogsQuery {
    pub action: Option<String>,
    pub entity_type: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

fn parse_query_date(s: &str, end_of_day: bool) -> Result<NaiveDateTime, AppError> {
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Ok(dt);
    }
    let date = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| AppError::Validation(format!("Invalid date '{}', use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS", s)))?;
    let time = if end_of_day {
        chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap()
    } else {
        chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
    };
    Ok(NaiveDateTime::new(date, time))
}

pub struct AuditLogService;

impl AuditLogService {
    /// GET /audit-logs
    /// Lists audit log events for the current tenant, most recent first. Supports optional
    /// filtering by action, entity_type, and a from_date/to_date range.
    pub async fn list_audit_logs(
        tenant: TenantContext,
        Query(q): Query<ListAuditLogsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let from_date = q.from_date.as_deref().map(|s| parse_query_date(s, false)).transpose()?;
        let to_date = q.to_date.as_deref().map(|s| parse_query_date(s, true)).transpose()?;
        let limit = q.limit.map(|l| l as i64).or(Some(50));
        let offset = q.offset.map(|o| o as i64);

        let logs = state
            .audit_log_repo
            .list_audit_logs(&tenant.0, q.action.as_deref(), q.entity_type.as_deref(), from_date, to_date, limit, offset)
            .await?;
        let total = state
            .audit_log_repo
            .count_audit_logs(&tenant.0, q.action.as_deref(), q.entity_type.as_deref(), from_date, to_date)
            .await?;

        let response = PaginatedResponse {
            data: logs,
            total,
            limit: limit.unwrap_or(50),
            offset: offset.unwrap_or(0),
        };
        Ok(Json(serde_json::to_value(response).unwrap()))
    }
}
