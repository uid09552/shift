use async_trait::async_trait;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use base64::{engine::general_purpose, Engine as _};

use crate::repository::AppState;

/// Realm role granting full read/write access.
const ROLE_PLANNER: &str = "shift-planner";
/// Realm role granting read-only access.
const ROLE_VIEWER: &str = "shift-viewer";

/// The tenant a request is scoped to. Every repository call takes this so a request
/// can never read or write another tenant's rows.
///
/// Resolved by the `authenticate` middleware: from the `tenant` claim of the
/// `x-access-token` JWT, or the server's configured default tenant in dev mode
/// (`--dev-mode --tenant-id=<id>`).
#[derive(Clone)]
pub struct TenantContext(pub String);

#[async_trait]
impl FromRequestParts<AppState> for TenantContext {
    type Rejection = StatusCode;

    /// Reads the tenant resolved by `authenticate`. Deliberately no fallback to
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

/// A role the caller holds. Roles the backend does not know about are ignored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// `shift-planner` — may use every method.
    Planner,
    /// `shift-viewer` — may only read.
    Viewer,
}

/// The roles a request carries, resolved by the `authenticate` middleware from the
/// `realm_access.roles` claim of the `x-access-token` JWT. In dev mode every request
/// is treated as a planner.
#[derive(Clone, Debug)]
pub struct RoleContext(pub Vec<Role>);

impl RoleContext {
    /// Whether the caller may perform mutating requests.
    pub fn can_write(&self) -> bool {
        self.0.contains(&Role::Planner)
    }

    /// Whether the caller may read at all — any known role does.
    pub fn can_read(&self) -> bool {
        !self.0.is_empty()
    }

    /// Whether the roles cover `method`. Safe methods need any known role, everything
    /// else needs `shift-planner`.
    fn allows(&self, method: &Method) -> bool {
        match *method {
            Method::GET | Method::HEAD | Method::OPTIONS => self.can_read(),
            _ => self.can_write(),
        }
    }
}

#[async_trait]
impl FromRequestParts<AppState> for RoleContext {
    type Rejection = StatusCode;

    /// Reads the roles resolved by `authenticate`. Like `TenantContext` there is no
    /// fallback: a request that skipped resolution has no roles at all.
    async fn from_request_parts(parts: &mut Parts, _state: &AppState) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<RoleContext>()
            .cloned()
            .ok_or(StatusCode::UNAUTHORIZED)
    }
}

/// Middleware that resolves tenant and roles for every API request, and enforces the
/// roles against the request method.
///
/// In dev mode the configured default tenant is used and the caller is a planner.
/// Otherwise the request must carry an `x-access-token` header with a JWT whose
/// `tenant` claim (array) names the caller's tenants — the first entry wins — and
/// whose `realm_access.roles` claim names their roles. Missing or undecodable tokens
/// are rejected with 401 — never falling back to the default tenant. A token whose
/// roles do not cover the request method is rejected with 403.
pub async fn authenticate(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let (tenant, roles) = if state.dev_mode {
        (state.default_tenant_id.clone(), RoleContext(vec![Role::Planner]))
    } else {
        let token = request
            .headers()
            .get("x-access-token")
            .ok_or(StatusCode::UNAUTHORIZED)?
            .to_str()
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        let claims = claims_from_token(token).ok_or(StatusCode::UNAUTHORIZED)?;
        let tenant = tenant_from_claims(&claims).ok_or(StatusCode::UNAUTHORIZED)?;
        (tenant, RoleContext(roles_from_claims(&claims)))
    };

    if !roles.allows(request.method()) {
        return Err(StatusCode::FORBIDDEN);
    }

    request.extensions_mut().insert(TenantContext(tenant));
    request.extensions_mut().insert(roles);
    Ok(next.run(request).await)
}

/// Decodes the payload of a JWT access token. The gateway (APISIX openid-connect
/// plugin) has already verified the token's signature and expiry, so only the payload
/// is decoded here.
fn claims_from_token(token: &str) -> Option<serde_json::Value> {
    let token = token.strip_prefix("Bearer ").unwrap_or(token);
    let payload = token.split('.').nth(1)?;
    let bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| general_purpose::URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Extracts the first entry of the `tenant` array claim.
fn tenant_from_claims(claims: &serde_json::Value) -> Option<String> {
    claims
        .get("tenant")?
        .as_array()?
        .iter()
        .find_map(|t| t.as_str())
        .map(str::to_string)
}

/// Extracts the known roles from the `realm_access.roles` claim. Keycloak puts a lot
/// of unrelated realm roles in there; anything the backend does not know is dropped.
fn roles_from_claims(claims: &serde_json::Value) -> Vec<Role> {
    let Some(roles) = claims.get("realm_access").and_then(|r| r.get("roles")).and_then(|r| r.as_array()) else {
        return Vec::new();
    };
    roles
        .iter()
        .filter_map(|r| match r.as_str()? {
            ROLE_PLANNER => Some(Role::Planner),
            ROLE_VIEWER => Some(Role::Viewer),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_token(payload: serde_json::Value) -> String {
        let header = general_purpose::URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","typ":"JWT"}"#);
        let body = general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
        format!("{header}.{body}.signature")
    }

    fn tenant_from_token(token: &str) -> Option<String> {
        tenant_from_claims(&claims_from_token(token)?)
    }

    fn roles_from_token(token: &str) -> Vec<Role> {
        claims_from_token(token).map(|c| roles_from_claims(&c)).unwrap_or_default()
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

    #[test]
    fn extracts_known_realm_roles_only() {
        let token = make_token(serde_json::json!({
            "tenant": ["orga"],
            "realm_access": { "roles": ["offline_access", "shift-planner", "uma_authorization"] }
        }));
        assert_eq!(roles_from_token(&token), vec![Role::Planner]);
    }

    #[test]
    fn missing_realm_access_yields_no_roles() {
        assert!(roles_from_token(&make_token(serde_json::json!({ "tenant": ["orga"] }))).is_empty());
        assert!(roles_from_token(&make_token(serde_json::json!({ "realm_access": {} }))).is_empty());
        assert!(roles_from_token(&make_token(serde_json::json!({ "realm_access": { "roles": ["nurse"] } }))).is_empty());
    }

    #[test]
    fn planner_may_write_viewer_may_only_read() {
        let planner = RoleContext(vec![Role::Planner]);
        let viewer = RoleContext(vec![Role::Viewer]);
        let none = RoleContext(vec![]);

        for method in [Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(planner.allows(&method), "planner should be allowed {method}");
        }

        assert!(viewer.allows(&Method::GET));
        assert!(viewer.allows(&Method::HEAD));
        for method in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(!viewer.allows(&method), "viewer should be denied {method}");
        }

        assert!(!none.allows(&Method::GET));
        assert!(!none.allows(&Method::POST));
    }
}
