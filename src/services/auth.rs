use axum::{http::StatusCode, Json};
use axum::http::HeaderMap;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct UserInfo {
    pub sub: Option<String>,
    pub preferred_username: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
}

/// Decodes the X-Userinfo header set by APISIX openid-connect plugin (base64 JSON)
/// and returns the user info from the OIDC token.
pub async fn get_self(headers: HeaderMap) -> Result<Json<UserInfo>, StatusCode> {
    let raw = headers
        .get("x-userinfo")
        .ok_or(StatusCode::UNAUTHORIZED)?
        .to_str()
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let bytes = general_purpose::STANDARD
        .decode(raw)
        .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(raw))
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let info: UserInfo = serde_json::from_slice(&bytes)
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    Ok(Json(info))
}
