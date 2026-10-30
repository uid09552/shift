use axum::{extract::State, Json};
use axum::http::HeaderMap;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::services::shift_swap::caller_employee;
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct UserInfo {
    pub sub: Option<String>,
    pub preferred_username: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    /// Realm roles the request carries, added by `get_self` from the access token
    /// rather than the userinfo header — the UI needs them to hide admin-only
    /// screens. Defaulted so the struct still parses the header itself, which has
    /// no such field (see `audit_log::AuditActor`).
    #[serde(default)]
    pub roles: Vec<String>,
    /// The caller's own employee in their tenant, matched by e-mail or username
    /// the way shift swaps find the requester; null when nothing matches.
    #[serde(default)]
    pub employee_id: Option<Uuid>,
}

/// Who the caller is: their roles, their identity and their own employee.
///
/// The identity starts from the access token's claims, which every request
/// carries, and is overlaid by the gateway's X-Userinfo header (base64 JSON from
/// APISIX's openid-connect plugin) where that is present — it adds names the
/// token may lack. Calls that do not come through the gateway, the MCP server's
/// among them, still learn who they are. In dev mode there is neither, so only
/// the roles are known.
pub async fn get_self(
    roles: RoleContext,
    user: UserContext,
    tenant: TenantContext,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UserInfo>, AppError> {
    let mut info = UserInfo {
        sub: user.subject.clone(),
        preferred_username: user.username.clone(),
        email: user.email.clone(),
        ..UserInfo::default()
    };
    if let Some(raw) = headers.get("x-userinfo") {
        let invalid = || AppError::Validation("The x-userinfo header is not valid base64 JSON".into());
        let raw = raw.to_str().map_err(|_| invalid())?;
        let bytes = general_purpose::STANDARD
            .decode(raw)
            .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(raw))
            .map_err(|_| invalid())?;
        let header: UserInfo = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        info.sub = header.sub.or(info.sub);
        info.preferred_username = header.preferred_username.or(info.preferred_username);
        info.email = header.email.or(info.email);
        info.name = header.name;
        info.given_name = header.given_name;
        info.family_name = header.family_name;
    }

    info.roles = roles.0.iter().map(|r| r.as_str().to_string()).collect();
    info.employee_id = caller_employee(&state, &tenant, &user).await?.map(|e| e.id);

    Ok(Json(info))
}
