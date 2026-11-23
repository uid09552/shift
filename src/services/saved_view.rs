//! Saved views: named filter sets a user keeps for a page (the Schedule page),
//! stored on the server so they follow the user across devices. A view is the
//! caller's own, keyed by the token's subject; planners and admins may share one
//! with the tenant. Per user and page the server also remembers the default view
//! (what the page opens with) and the one applied last.
//!
//! The filters are the page's business: the backend keeps them as a JSON object
//! and only bounds their size.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::domain::{SavedView, SavedViewPreference, SavedViewRepository};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::shift_swap::actor_name;
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

/// Pages that keep views. Anything else is refused, so a typo cannot scatter them.
pub const PAGES: [&str; 1] = ["schedule"];
const MAX_NAME: usize = 80;
const MAX_FILTER_BYTES: usize = 8 * 1024;

#[derive(Deserialize)]
pub struct PageQuery {
    pub page: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateSavedView {
    pub page: String,
    pub name: String,
    #[serde(default)]
    pub filters: Value,
    #[serde(default)]
    pub shared: bool,
}

#[derive(Deserialize)]
pub struct UpdateSavedView {
    pub name: Option<String>,
    pub filters: Option<Value>,
    pub shared: Option<bool>,
}

#[derive(Deserialize)]
pub struct UpdatePreferences {
    pub page: String,
    pub default_view_id: Option<Uuid>,
    pub last_view_id: Option<Uuid>,
}

/// Whose views these are: the token's subject, else the username or e-mail.
fn subject(user: &UserContext) -> Result<String, AppError> {
    user.subject
        .clone()
        .or_else(|| user.username.clone())
        .or_else(|| user.email.clone())
        .ok_or_else(|| AppError::Unauthorized("No user identity on the request".into()))
}

fn page(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if PAGES.contains(&value) {
        Ok(value.to_string())
    } else {
        Err(AppError::Validation(format!("Unknown page '{value}'; views are kept for: {}", PAGES.join(", "))))
    }
}

fn name(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::Validation("A view needs a name".into()));
    }
    if value.chars().count() > MAX_NAME {
        return Err(AppError::Validation(format!("A view's name has at most {MAX_NAME} characters")));
    }
    Ok(value.to_string())
}

fn filters(value: Value) -> Result<Value, AppError> {
    let value = if value.is_null() { json!({}) } else { value };
    if !value.is_object() {
        return Err(AppError::Validation("filters must be a JSON object".into()));
    }
    if value.to_string().len() > MAX_FILTER_BYTES {
        return Err(AppError::Validation(format!("filters are limited to {MAX_FILTER_BYTES} bytes")));
    }
    Ok(value)
}

fn ensure_may_share(roles: &RoleContext) -> Result<(), AppError> {
    if roles.can_write() {
        Ok(())
    } else {
        Err(AppError::Forbidden("Only a planner or an admin may share a view with everyone".into()))
    }
}

fn view_json(view: &SavedView, me: &str) -> Value {
    let mut body = serde_json::to_value(view).unwrap_or_else(|_| json!({}));
    body["mine"] = json!(view.owner_subject == me);
    body
}

/// The view, if the caller may see it: their own, or a shared one.
async fn visible(state: &AppState, tenant: &str, me: &str, id: Uuid) -> Result<SavedView, AppError> {
    match state.saved_view_repo.get_saved_view(tenant, id).await? {
        Some(view) if view.owner_subject == me || view.shared => Ok(view),
        _ => Err(AppError::NotFound),
    }
}

/// The view, if the caller may change it: their own, or — for an admin — a shared one.
async fn editable(state: &AppState, tenant: &str, me: &str, roles: &RoleContext, id: Uuid) -> Result<SavedView, AppError> {
    let view = visible(state, tenant, me, id).await?;
    if view.owner_subject == me || roles.is_admin() {
        Ok(view)
    } else {
        Err(AppError::Forbidden("Only its owner or an admin may change a shared view".into()))
    }
}

pub struct SavedViewService;

impl SavedViewService {
    /// GET /saved-views?page=schedule — the caller's views and the tenant's shared
    /// ones, with the caller's default and last-used view of the page.
    pub async fn list(
        tenant: TenantContext,
        user: UserContext,
        Query(q): Query<PageQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let me = subject(&user)?;
        let page = page(q.page.as_deref().unwrap_or("schedule"))?;
        let views = state.saved_view_repo.list_saved_views(&tenant.0, &me, &page).await?;
        let mut pref = state.saved_view_repo.get_view_preference(&tenant.0, &me, &page).await?;
        // A view shared once and then made private again is no longer the caller's to use.
        let ids: Vec<Uuid> = views.iter().map(|v| v.id).collect();
        pref.default_view_id = pref.default_view_id.filter(|id| ids.contains(id));
        pref.last_view_id = pref.last_view_id.filter(|id| ids.contains(id));
        Ok(Json(json!({
            "page": page,
            "views": views.iter().map(|v| view_json(v, &me)).collect::<Vec<_>>(),
            "default_view_id": pref.default_view_id,
            "last_view_id": pref.last_view_id,
        })))
    }

    /// POST /saved-views — a new view of the caller's. 409 on a name they already use there.
    pub async fn create(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<CreateSavedView>,
    ) -> Result<Json<Value>, AppError> {
        let me = subject(&user)?;
        let page = page(&body.page)?;
        let name = name(&body.name)?;
        let filters = filters(body.filters)?;
        if body.shared {
            ensure_may_share(&roles)?;
        }
        let owner = actor_name(&actor, &user);
        let view = state
            .saved_view_repo
            .create_saved_view(&tenant.0, &me, owner.as_deref(), &page, &name, filters, body.shared)
            .await
            .map_err(|e| match e {
                AppError::Duplicate => AppError::Conflict(format!("You already have a view called '{name}'")),
                other => other,
            })?;
        audit_log::record(
            &state, &tenant.0, owner, "saved_view.create", "saved_view", Some(view.id.to_string()),
            Some(json!({"name": view.name, "page": view.page, "shared": view.shared}).to_string()),
        )
        .await;
        Ok(Json(view_json(&view, &me)))
    }

    /// PUT /saved-views/{id} — rename, change the filters, share or unshare.
    pub async fn update(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<UpdateSavedView>,
    ) -> Result<Json<Value>, AppError> {
        let me = subject(&user)?;
        let current = editable(&state, &tenant.0, &me, &roles, id).await?;
        let name = body.name.as_deref().map(name).transpose()?;
        let filters = body.filters.map(filters).transpose()?;
        if body.shared == Some(true) && !current.shared {
            ensure_may_share(&roles)?;
        }
        let view = state
            .saved_view_repo
            .update_saved_view(&tenant.0, id, name.clone(), filters, body.shared)
            .await
            .map_err(|e| match e {
                AppError::Duplicate => AppError::Conflict(format!("There is already a view called '{}'", name.unwrap_or_default())),
                other => other,
            })?;
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "saved_view.update", "saved_view", Some(id.to_string()),
            Some(json!({"name": view.name, "page": view.page, "shared": view.shared}).to_string()),
        )
        .await;
        Ok(Json(view_json(&view, &me)))
    }

    /// DELETE /saved-views/{id} — whoever had it as their default falls back to none.
    pub async fn delete(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let me = subject(&user)?;
        let view = editable(&state, &tenant.0, &me, &roles, id).await?;
        if !state.saved_view_repo.delete_saved_view(&tenant.0, id).await? {
            return Err(AppError::NotFound);
        }
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "saved_view.delete", "saved_view", Some(id.to_string()),
            Some(json!({"name": view.name}).to_string()),
        )
        .await;
        Ok(Json(json!({"deleted": id})))
    }

    /// PUT /saved-views/preferences — the caller's default and last-used view of a
    /// page; `null` clears either. Both must be views the caller can see there.
    pub async fn update_preferences(
        tenant: TenantContext,
        user: UserContext,
        State(state): State<AppState>,
        Json(body): Json<UpdatePreferences>,
    ) -> Result<Json<Value>, AppError> {
        let me = subject(&user)?;
        let page = page(&body.page)?;
        for id in [body.default_view_id, body.last_view_id].into_iter().flatten() {
            let view = visible(&state, &tenant.0, &me, id).await?;
            if view.page != page {
                return Err(AppError::Validation(format!("View '{}' belongs to another page", view.name)));
            }
        }
        let pref = SavedViewPreference { default_view_id: body.default_view_id, last_view_id: body.last_view_id };
        let pref = state.saved_view_repo.set_view_preference(&tenant.0, &me, &page, pref).await?;
        Ok(Json(json!({
            "page": page,
            "default_view_id": pref.default_view_id,
            "last_view_id": pref.last_view_id,
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_trimmed_and_bounded() {
        assert_eq!(name("  Night team ").unwrap(), "Night team");
        assert!(name("   ").is_err());
        assert!(name(&"x".repeat(81)).is_err());
        assert!(name(&"ä".repeat(80)).is_ok(), "characters, not bytes");
    }

    #[test]
    fn filters_are_an_object_of_bounded_size() {
        assert_eq!(filters(Value::Null).unwrap(), json!({}));
        assert!(filters(json!([1, 2])).is_err());
        assert!(filters(json!({"workstations": ["a"]})).is_ok());
        assert!(filters(json!({"x": "y".repeat(MAX_FILTER_BYTES)})).is_err());
    }

    #[test]
    fn only_known_pages_keep_views() {
        assert_eq!(page(" schedule ").unwrap(), "schedule");
        assert!(page("kalender").is_err());
    }
}
