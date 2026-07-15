use async_trait::async_trait;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use base64::{engine::general_purpose, Engine as _};

use crate::repository::AppState;

/// The tenant a request is scoped to. Every repository call takes this so a request
/// can never read or write another tenant's rows.
///
/// Resolved by the `resolve_tenant` middleware: from the `tenant` claim of the
/// `x-access-token` JWT, or the server's configured default tenant in dev mode
/// (`--dev-mode --tenant-id=<id>`).
#[derive(Clone)]
pub struct TenantContext(pub String);

#[async_trait]
impl FromRequestParts<AppState> for TenantContext {
    type Rejection = StatusCode;

    /// Reads the tenant resolved by `resolve_tenant`. Deliberately no fallback to
    /// `state.default_tenant_id` here: a request that skipped tenant resolution must
    /// fail rather than silently operate on the default tenant.
    async fn from_request_parts(parts: &mut Parts, _state: &AppState) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<TenantContext>()
            .cloned()
            .ok_or(StatusCode::UNAUTHORIZED)
    }
}

/// Middleware that resolves the tenant for every API request.
///
/// In dev mode the configured default tenant is used. Otherwise the request must
/// carry an `x-access-token` header with a JWT whose `tenant` claim (array) names
/// the caller's tenants; the first entry wins. Missing or undecodable tokens are
/// rejected with 401 — never falling back to the default tenant.
pub async fn resolve_tenant(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let tenant = if state.dev_mode {
        state.default_tenant_id.clone()
    } else {
        let token = request
            .headers()
            .get("x-access-token")
            .ok_or(StatusCode::UNAUTHORIZED)?
            .to_str()
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        tenant_from_token(token).ok_or(StatusCode::UNAUTHORIZED)?
    };

    request.extensions_mut().insert(TenantContext(tenant));
    Ok(next.run(request).await)
}

/// Extracts the first entry of the `tenant` array claim from a JWT access token.
/// The gateway (APISIX openid-connect plugin) has already verified the token's
/// signature and expiry, so only the payload is decoded here.
fn tenant_from_token(token: &str) -> Option<String> {
    let token = token.strip_prefix("Bearer ").unwrap_or(token);
    let payload = token.split('.').nth(1)?;
    let bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| general_purpose::URL_SAFE.decode(payload))
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims
        .get("tenant")?
        .as_array()?
        .iter()
        .find_map(|t| t.as_str())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_token(payload: serde_json::Value) -> String {
        let header = general_purpose::URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","typ":"JWT"}"#);
        let body = general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
        format!("{header}.{body}.signature")
    }

    #[test]
    fn extracts_first_tenant() {
        let token = make_token(serde_json::json!({
            "sub": "3a9e23b8-4a00-478c-99b7-eb68df54bc40",
            "tenant": ["orga", "orgb"]
        }));
        assert_eq!(tenant_from_token(&token), Some("orga".to_string()));
    }

    #[test]
    fn accepts_bearer_prefix() {
        let token = make_token(serde_json::json!({ "tenant": ["orga"] }));
        assert_eq!(tenant_from_token(&format!("Bearer {token}")), Some("orga".to_string()));
    }

    #[test]
    fn rejects_missing_or_empty_tenant_claim() {
        assert_eq!(tenant_from_token(&make_token(serde_json::json!({ "sub": "x" }))), None);
        assert_eq!(tenant_from_token(&make_token(serde_json::json!({ "tenant": [] }))), None);
        assert_eq!(tenant_from_token(&make_token(serde_json::json!({ "tenant": "orga" }))), None);
    }

    #[test]
    fn rejects_garbage_token() {
        assert_eq!(tenant_from_token("not-a-jwt"), None);
        assert_eq!(tenant_from_token("a.b.c"), None);
    }
}
