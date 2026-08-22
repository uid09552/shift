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
/// Realm role granting full read/write access, on top of planner rights.
const ROLE_ADMIN: &str = "shift-admin";
/// Realm role granting read-only access, plus write access to the caller's own
/// self-service data (see `SELF_SERVICE_SEGMENTS`).
const ROLE_VIEWER: &str = "shift-viewer";

/// Path segments whose mutations a `shift-viewer` may perform for their own records.
/// The method check below lets those requests through; the handler is responsible for
/// verifying ownership against the caller's identity (`UserContext`).
const SELF_SERVICE_SEGMENTS: [&str; 1] = ["shift-wishes"];

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
    /// `shift-admin` — may use every method.
    Admin,
    /// `shift-viewer` — may only read, except for their own self-service data.
    Viewer,
}

/// The roles a request carries, resolved by the `authenticate` middleware from the
/// `realm_access.roles` claim of the `x-access-token` JWT. In dev mode every request
/// is treated as a planner.
#[derive(Clone, Debug)]
pub struct RoleContext(pub Vec<Role>);

impl RoleContext {
    /// Whether the caller may perform mutating requests on any record.
    pub fn can_write(&self) -> bool {
        self.0.contains(&Role::Planner) || self.0.contains(&Role::Admin)
    }

    /// Whether the caller may read at all — any known role does.
    pub fn can_read(&self) -> bool {
        !self.0.is_empty()
    }

    /// Whether the roles cover `method` on `path`. Safe methods need any known role.
    /// Mutations need `shift-planner` or `shift-admin`, except on self-service paths,
    /// where any reader passes here and the handler enforces ownership.
    fn allows(&self, method: &Method, path: &str) -> bool {
        match *method {
            Method::GET | Method::HEAD | Method::OPTIONS => self.can_read(),
            _ if is_self_service_path(path) => self.can_read(),
            _ => self.can_write(),
        }
    }
}

/// Whether `path` is one a `shift-viewer` may mutate for their own records.
fn is_self_service_path(path: &str) -> bool {
    path.split('/').any(|segment| SELF_SERVICE_SEGMENTS.contains(&segment))
}

/// Who the caller is, resolved by the `authenticate` middleware from the
/// `x-access-token` JWT. Used by handlers that let a `shift-viewer` write their own
/// records: the record's owner must match one of these identifiers.
#[derive(Clone, Debug, Default)]
pub struct UserContext {
    pub subject: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
}

impl UserContext {
    /// Whether `email` identifies the caller. Employees are keyed by e-mail address,
    /// which Keycloak may carry either as the `email` claim or — when the realm logs
    /// in with e-mail addresses — as `preferred_username`. Both are compared
    /// case-insensitively, as e-mail local parts are treated case-insensitively here.
    pub fn matches_email(&self, email: &str) -> bool {
        let matches = |claim: &Option<String>| {
            claim
                .as_deref()
                .is_some_and(|c| c.eq_ignore_ascii_case(email))
        };
        matches(&self.email) || matches(&self.username)
    }
}

#[async_trait]
impl FromRequestParts<AppState> for UserContext {
    type Rejection = StatusCode;

    /// Reads the identity resolved by `authenticate`. A request that skipped
    /// resolution has no identity and cannot pass an ownership check.
    async fn from_request_parts(parts: &mut Parts, _state: &AppState) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<UserContext>()
            .cloned()
            .ok_or(StatusCode::UNAUTHORIZED)
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
    let (tenant, roles, user) = if state.dev_mode {
        (
            state.default_tenant_id.clone(),
            RoleContext(vec![Role::Planner]),
            UserContext::default(),
        )
    } else {
        let token = request
            .headers()
            .get("x-access-token")
            .ok_or(StatusCode::UNAUTHORIZED)?
            .to_str()
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        let claims = claims_from_token(token).ok_or(StatusCode::UNAUTHORIZED)?;
        let tenant = tenant_from_claims(&claims).ok_or(StatusCode::UNAUTHORIZED)?;
        (
            tenant,
            RoleContext(roles_from_claims(&claims)),
            user_from_claims(&claims),
        )
    };

    if !roles.allows(request.method(), request.uri().path()) {
        return Err(StatusCode::FORBIDDEN);
    }

    request.extensions_mut().insert(TenantContext(tenant));
    request.extensions_mut().insert(roles);
    request.extensions_mut().insert(user);
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
            ROLE_ADMIN => Some(Role::Admin),
            ROLE_VIEWER => Some(Role::Viewer),
            _ => None,
        })
        .collect()
}

/// Extracts the caller's identity from the standard OIDC claims.
fn user_from_claims(claims: &serde_json::Value) -> UserContext {
    let claim = |name: &str| {
        claims
            .get(name)
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    UserContext {
        subject: claim("sub"),
        username: claim("preferred_username"),
        email: claim("email"),
    }
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
        let path = "/api/v1/employees";

        for method in [Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(planner.allows(&method, path), "planner should be allowed {method}");
        }

        assert!(viewer.allows(&Method::GET, path));
        assert!(viewer.allows(&Method::HEAD, path));
        for method in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(!viewer.allows(&method, path), "viewer should be denied {method}");
        }

        assert!(!none.allows(&Method::GET, path));
        assert!(!none.allows(&Method::POST, path));
    }

    #[test]
    fn admin_may_write_like_a_planner() {
        let token = make_token(serde_json::json!({
            "tenant": ["orga"],
            "realm_access": { "roles": ["shift-admin"] }
        }));
        assert_eq!(roles_from_token(&token), vec![Role::Admin]);

        let admin = RoleContext(vec![Role::Admin]);
        for method in [Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(admin.allows(&method, "/api/v1/employees"), "admin should be allowed {method}");
        }
    }

    #[test]
    fn viewer_may_mutate_self_service_paths() {
        let viewer = RoleContext(vec![Role::Viewer]);
        let none = RoleContext(vec![]);

        for path in ["/api/v1/shift-wishes", "/api/v1/shift-wishes/3a9e23b8-4a00-478c-99b7-eb68df54bc40"] {
            assert!(viewer.allows(&Method::POST, path), "viewer should reach {path}");
            assert!(viewer.allows(&Method::DELETE, path), "viewer should reach {path}");
            assert!(!none.allows(&Method::POST, path), "roleless caller should not reach {path}");
        }

        // Nothing else opens up just because the word appears in a query-ish segment.
        assert!(!viewer.allows(&Method::POST, "/api/v1/confirmed-shift-plans"));
    }

    #[test]
    fn identity_matches_email_or_username_case_insensitively() {
        let claims = serde_json::json!({
            "sub": "3a9e23b8-4a00-478c-99b7-eb68df54bc40",
            "preferred_username": "Nurse.Jane",
            "email": "Jane@Hospital.Example"
        });
        let user = user_from_claims(&claims);

        assert_eq!(user.subject.as_deref(), Some("3a9e23b8-4a00-478c-99b7-eb68df54bc40"));
        assert!(user.matches_email("jane@hospital.example"));
        assert!(user.matches_email("nurse.jane"));
        assert!(!user.matches_email("john@hospital.example"));
    }

    #[test]
    fn identity_without_claims_matches_nobody() {
        let user = user_from_claims(&serde_json::json!({ "tenant": ["orga"] }));
        assert!(!user.matches_email("jane@hospital.example"));
        assert!(!UserContext::default().matches_email(""));
    }
}
