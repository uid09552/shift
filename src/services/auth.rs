use axum::{http::StatusCode, Json};
use axum::http::HeaderMap;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

use crate::services::tenant::RoleContext;

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
}

/// Decodes the X-Userinfo header set by APISIX openid-connect plugin (base64 JSON)
/// and returns the user info from the OIDC token, plus the roles the request carries.
///
/// The header is absent in dev mode (no gateway in front), where the identity is
/// unknown but the roles still are — so a missing header yields the roles alone
/// rather than 401.
pub async fn get_self(roles: RoleContext, headers: HeaderMap) -> Result<Json<UserInfo>, StatusCode> {
    let mut info = match headers.get("x-userinfo") {
        None => UserInfo::default(),
        Some(raw) => {
            let raw = raw.to_str().map_err(|_| StatusCode::BAD_REQUEST)?;
            let bytes = general_purpose::STANDARD
                .decode(raw)
                .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(raw))
                .map_err(|_| StatusCode::BAD_REQUEST)?;
            serde_json::from_slice(&bytes).map_err(|_| StatusCode::BAD_REQUEST)?
        }
    };

    info.roles = roles.0.iter().map(|r| r.as_str().to_string()).collect();

    Ok(Json(info))
}
