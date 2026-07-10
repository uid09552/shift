use async_trait::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use std::convert::Infallible;

use crate::repository::AppState;

/// The tenant a request is scoped to. Every repository call takes this so a request
/// can never read or write another tenant's rows.
///
/// Resolution today is always the server's configured default tenant (set via
/// `--dev-mode --tenant-id=<id>`). Once real multi-tenant auth exists, this will instead
/// decode the tenant from the caller's auth token (see `crate::services::auth::get_self`
/// for the existing token-header handling to build on).
pub struct TenantContext(pub String);

#[async_trait]
impl FromRequestParts<AppState> for TenantContext {
    type Rejection = Infallible;

    async fn from_request_parts(_parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        Ok(TenantContext(state.default_tenant_id.clone()))
    }
}
