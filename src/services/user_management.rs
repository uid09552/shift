//! User management for a tenant: who belongs to the caller's organization, and
//! which of the three shift roles each of them holds.
//!
//! Users live in Keycloak, not in this database — an account is a realm user, and
//! belonging to a tenant is membership in that tenant's Keycloak organization. So
//! every call here goes to the Keycloak Admin API (`services::keycloak`).
//!
//! Two rules run through the whole module:
//!
//! * **`shift-admin` only.** The role middleware only knows the request method, and
//!   a `shift-planner` may use every method — so each handler checks `is_admin()`
//!   itself, the same way the wish window does.
//! * **The caller's own organization only.** The organization is resolved from the
//!   request's tenant, never from the request body, and a user that is not a member
//!   of it is a 404 here even though the account exists in the realm. An admin of
//!   one hospital can neither see nor touch another hospital's staff.

use axum::{
    extract::{Path, State},
    Json,
};
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::keycloak::{KeycloakAdmin, KeycloakUser, NewUser, Organization, RealmRole};
use crate::services::tenant::{Role, RoleContext, TenantContext, UserContext};

/// The roles this endpoint may hand out. Keycloak realms carry plenty of other
/// roles (`offline_access`, `default-roles-shift`, …); assigning those is not part
/// of shift management, and letting a request name one would turn role assignment
/// into arbitrary privilege granting.
const ASSIGNABLE_ROLES: [Role; 3] = [Role::Admin, Role::Planner, Role::Viewer];

/// A member of the caller's organization, as the API returns them.
#[derive(Debug, Serialize)]
pub struct OrganizationUser {
    pub id: String,
    pub username: Option<String>,
    pub email: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub enabled: bool,
    /// Only the shift roles, in the fixed order admin, planner, viewer — the other
    /// realm roles a Keycloak account carries are none of this screen's business.
    pub roles: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    /// Optional: without one, the account cannot be signed into until a password is
    /// set in Keycloak (by a reset mail, or by the realm admin).
    #[serde(default)]
    pub password: Option<String>,
    /// Whether that password must be changed at first login. Defaults to true —
    /// a password an admin typed should not stay the user's permanent one.
    #[serde(default = "default_true")]
    pub temporary_password: bool,
    #[serde(default)]
    pub roles: Vec<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct UpdateRolesRequest {
    /// The complete set of shift roles the user should hold afterwards. Roles not
    /// listed are removed, so this is a replace, not an add.
    pub roles: Vec<String>,
}

pub struct UserManagementService;

impl UserManagementService {
    /// Everyone in the caller's organization, with the shift roles they hold.
    pub async fn list_users(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<OrganizationUser>>, AppError> {
        let (keycloak, org) = admin_context(&state, &tenant, &roles).await?;

        let members = keycloak.list_organization_members(&org.id).await?;

        // One role-mapping call per member. They run concurrently because an
        // organization of a few hundred staff would otherwise be a few hundred
        // round trips end to end.
        let with_roles = join_all(members.into_iter().map(|member| {
            let keycloak = keycloak.clone();
            async move {
                let roles = keycloak.user_realm_roles(&member.id).await?;
                Ok::<_, AppError>(to_organization_user(member, &roles))
            }
        }))
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;

        Ok(Json(sorted(with_roles)))
    }

    /// Adds a user to the caller's organization and gives them their roles.
    ///
    /// An account whose username or e-mail already exists in the realm is *joined*
    /// to the organization rather than rejected: staff who already have a login for
    /// another organization (or a leftover account) should be addable without an
    /// admin having to go into Keycloak.
    pub async fn create_user(
        tenant: TenantContext,
        roles: RoleContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<CreateUserRequest>,
    ) -> Result<Json<OrganizationUser>, AppError> {
        let (keycloak, org) = admin_context(&state, &tenant, &roles).await?;

        let username = body.username.trim().to_string();
        if username.is_empty() {
            return Err(AppError::Validation("username must not be empty".into()));
        }
        let requested = resolve_roles(&body.roles)?;

        // An existing account is reused; only a genuinely new one is created.
        let existing = keycloak.find_users_exact(&username).await?;
        let existing = match (&existing.first(), &body.email) {
            (Some(user), _) => Some((*user).clone()),
            (None, Some(email)) => keycloak.find_users_exact(email.trim()).await?.into_iter().next(),
            (None, None) => None,
        };

        let (user_id, created) = match existing {
            Some(user) => {
                if keycloak.is_organization_member(&org.id, &user.id).await? {
                    return Err(AppError::Duplicate);
                }
                (user.id, false)
            }
            None => {
                let new_user = NewUser {
                    username: username.clone(),
                    email: body.email.as_ref().map(|e| e.trim().to_string()).filter(|e| !e.is_empty()),
                    first_name: non_empty(body.first_name.as_deref()),
                    last_name: non_empty(body.last_name.as_deref()),
                    enabled: true,
                    password: body.password.clone().filter(|p| !p.is_empty()),
                    temporary_password: body.temporary_password,
                };
                (keycloak.create_user(&new_user).await?, true)
            }
        };

        keycloak.add_organization_member(&org.id, &user_id).await?;

        let catalogue = role_catalogue(&keycloak).await?;
        let to_add = pick_roles(&catalogue, &requested);
        if let Err(e) = keycloak.add_realm_roles(&user_id, &to_add).await {
            // The member exists but without the roles that were asked for — that is
            // a half-made user, so undo what this request created rather than leave
            // one behind. A pre-existing account keeps its membership elsewhere.
            let _ = keycloak.remove_organization_member(&org.id, &user_id).await;
            if created {
                let _ = keycloak.delete_user(&user_id).await;
            }
            return Err(e);
        }

        let user = load_user(&keycloak, &user_id).await?;

        audit(
            &state,
            &tenant,
            actor,
            if created { "user.create" } else { "user.add_to_organization" },
            &user,
        )
        .await;

        Ok(Json(user))
    }

    /// Replaces the shift roles of one member. Roles the request does not name are
    /// taken away, so this is the full picture, not a delta.
    pub async fn update_user_roles(
        tenant: TenantContext,
        roles: RoleContext,
        caller: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Path(user_id): Path<String>,
        Json(body): Json<UpdateRolesRequest>,
    ) -> Result<Json<OrganizationUser>, AppError> {
        let (keycloak, org) = admin_context(&state, &tenant, &roles).await?;
        require_member(&keycloak, &org, &user_id).await?;

        let requested = resolve_roles(&body.roles)?;

        // Taking `shift-admin` off yourself locks the last admin out of this screen
        // — and out of the wish window with it. Someone else has to do it.
        if caller.subject.as_deref() == Some(user_id.as_str()) && !requested.contains(&Role::Admin) {
            return Err(AppError::Validation(
                "You cannot remove your own shift-admin role — ask another admin to do it".into(),
            ));
        }

        let catalogue = role_catalogue(&keycloak).await?;
        let held = keycloak.user_realm_roles(&user_id).await?;
        let held_shift_roles: Vec<Role> = held.iter().filter_map(|r| known_role(&r.name)).collect();

        let to_add = pick_roles(
            &catalogue,
            &requested
                .iter()
                .copied()
                .filter(|r| !held_shift_roles.contains(r))
                .collect::<Vec<_>>(),
        );
        let to_remove = pick_roles(
            &catalogue,
            &held_shift_roles
                .iter()
                .copied()
                .filter(|r| !requested.contains(r))
                .collect::<Vec<_>>(),
        );

        keycloak.add_realm_roles(&user_id, &to_add).await?;
        keycloak.remove_realm_roles(&user_id, &to_remove).await?;

        let user = load_user(&keycloak, &user_id).await?;
        audit(&state, &tenant, actor, "user.update_roles", &user).await;

        Ok(Json(user))
    }

    /// Removes a member from the caller's organization, and with them the shift
    /// roles that only made sense inside it. The realm account itself stays: it may
    /// be a member of another organization, and deleting logins is Keycloak's job.
    pub async fn remove_user(
        tenant: TenantContext,
        roles: RoleContext,
        caller: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Path(user_id): Path<String>,
    ) -> Result<Json<serde_json::Value>, AppError> {
        let (keycloak, org) = admin_context(&state, &tenant, &roles).await?;
        require_member(&keycloak, &org, &user_id).await?;

        if caller.subject.as_deref() == Some(user_id.as_str()) {
            return Err(AppError::Validation(
                "You cannot remove yourself from the organization".into(),
            ));
        }

        let user = load_user(&keycloak, &user_id).await?;

        let catalogue = role_catalogue(&keycloak).await?;
        let held: Vec<Role> = keycloak
            .user_realm_roles(&user_id)
            .await?
            .iter()
            .filter_map(|r| known_role(&r.name))
            .collect();
        keycloak
            .remove_realm_roles(&user_id, &pick_roles(&catalogue, &held))
            .await?;
        keycloak.remove_organization_member(&org.id, &user_id).await?;

        audit(&state, &tenant, actor, "user.remove_from_organization", &user).await;

        Ok(Json(serde_json::json!({ "status": "removed", "id": user_id })))
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// The two things every handler needs: an admin caller, and the Keycloak
/// organization standing for their tenant.
async fn admin_context(
    state: &AppState,
    tenant: &TenantContext,
    roles: &RoleContext,
) -> Result<(std::sync::Arc<KeycloakAdmin>, Organization), AppError> {
    if !roles.is_admin() {
        return Err(AppError::Forbidden(
            "Only shift-admin may manage users of the organization".into(),
        ));
    }
    let keycloak = state.keycloak.clone().ok_or_else(|| {
        AppError::Unavailable(
            "User management is unavailable: no Keycloak admin connection is configured \
             (set keycloak.url, keycloak.realm, keycloak.client_id and keycloak.client_secret)"
                .into(),
        )
    })?;
    let org = keycloak.find_organization(&tenant.0).await?;
    Ok((keycloak, org))
}

/// A user outside the caller's organization does not exist as far as this API is
/// concerned — not "forbidden", which would confirm the account is there.
async fn require_member(
    keycloak: &KeycloakAdmin,
    org: &Organization,
    user_id: &str,
) -> Result<(), AppError> {
    if keycloak.is_organization_member(&org.id, user_id).await? {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}

async fn load_user(keycloak: &KeycloakAdmin, user_id: &str) -> Result<OrganizationUser, AppError> {
    let user = keycloak.get_user(user_id).await?;
    let roles = keycloak.user_realm_roles(user_id).await?;
    Ok(to_organization_user(user, &roles))
}

async fn role_catalogue(keycloak: &KeycloakAdmin) -> Result<Vec<RealmRole>, AppError> {
    keycloak.list_realm_roles().await
}

/// Turns role names from a request into the roles this API knows, rejecting
/// anything else by name so a typo is not silently dropped.
fn resolve_roles(names: &[String]) -> Result<Vec<Role>, AppError> {
    let mut roles: Vec<Role> = Vec::new();
    for name in names {
        let role = known_role(name.trim()).ok_or_else(|| {
            AppError::Validation(format!(
                "Unknown role '{}' — assignable roles are {}",
                name.trim(),
                ASSIGNABLE_ROLES.map(|r| r.as_str()).join(", ")
            ))
        })?;
        if !roles.contains(&role) {
            roles.push(role);
        }
    }
    Ok(roles)
}

fn known_role(name: &str) -> Option<Role> {
    ASSIGNABLE_ROLES.into_iter().find(|r| r.as_str() == name)
}

/// The Keycloak representations of `roles`. A role the realm does not define is
/// skipped rather than failing the request — the realm import is what should carry
/// it, and a missing one is visible in the response's role list afterwards.
fn pick_roles(catalogue: &[RealmRole], roles: &[Role]) -> Vec<RealmRole> {
    roles
        .iter()
        .filter_map(|role| catalogue.iter().find(|c| c.name == role.as_str()).cloned())
        .collect()
}

fn to_organization_user(user: KeycloakUser, roles: &[RealmRole]) -> OrganizationUser {
    let held: Vec<Role> = roles.iter().filter_map(|r| known_role(&r.name)).collect();
    OrganizationUser {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        enabled: user.enabled,
        roles: ASSIGNABLE_ROLES
            .into_iter()
            .filter(|r| held.contains(r))
            .map(|r| r.as_str().to_string())
            .collect(),
    }
}

/// By name, so the list does not reshuffle between reloads the way Keycloak's own
/// member order can.
fn sorted(mut users: Vec<OrganizationUser>) -> Vec<OrganizationUser> {
    users.sort_by(|a, b| {
        let key = |u: &OrganizationUser| {
            u.username
                .clone()
                .or_else(|| u.email.clone())
                .unwrap_or_else(|| u.id.clone())
                .to_lowercase()
        };
        key(a).cmp(&key(b))
    });
    users
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value.map(str::trim).filter(|v| !v.is_empty()).map(str::to_string)
}

async fn audit(
    state: &AppState,
    tenant: &TenantContext,
    actor: AuditActor,
    action: &str,
    user: &OrganizationUser,
) {
    let changes = serde_json::to_string(user).unwrap_or_default();
    audit_log::record(
        state,
        &tenant.0,
        actor.0,
        action,
        "user",
        Some(user.id.clone()),
        Some(changes),
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalogue() -> Vec<RealmRole> {
        vec![
            RealmRole { id: "1".into(), name: "shift-admin".into() },
            RealmRole { id: "2".into(), name: "shift-planner".into() },
            RealmRole { id: "3".into(), name: "shift-viewer".into() },
            RealmRole { id: "4".into(), name: "offline_access".into() },
        ]
    }

    fn user(id: &str, username: &str) -> KeycloakUser {
        KeycloakUser {
            id: id.into(),
            username: Some(username.into()),
            email: None,
            first_name: None,
            last_name: None,
            enabled: true,
        }
    }

    #[test]
    fn only_shift_roles_may_be_assigned() {
        assert_eq!(
            resolve_roles(&["shift-planner".into(), "shift-viewer".into()]).unwrap(),
            vec![Role::Planner, Role::Viewer]
        );
        // A realm role that exists but is not ours is refused by name.
        assert!(resolve_roles(&["realm-admin".into()]).is_err());
        assert!(resolve_roles(&["offline_access".into()]).is_err());
        assert!(resolve_roles(&["Shift-Admin".into()]).is_err());
    }

    #[test]
    fn role_lists_are_deduplicated_and_may_be_empty() {
        assert_eq!(
            resolve_roles(&["shift-viewer".into(), " shift-viewer ".into()]).unwrap(),
            vec![Role::Viewer]
        );
        assert!(resolve_roles(&[]).unwrap().is_empty());
    }

    #[test]
    fn picking_roles_ignores_ones_the_realm_does_not_define() {
        let picked = pick_roles(&catalogue(), &[Role::Admin, Role::Viewer]);
        assert_eq!(
            picked.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            vec!["shift-admin", "shift-viewer"]
        );

        assert!(pick_roles(&[], &[Role::Admin]).is_empty());
        assert!(pick_roles(&catalogue(), &[]).is_empty());
    }

    #[test]
    fn responses_carry_shift_roles_only_in_a_fixed_order() {
        let held = vec![
            RealmRole { id: "4".into(), name: "offline_access".into() },
            RealmRole { id: "3".into(), name: "shift-viewer".into() },
            RealmRole { id: "1".into(), name: "shift-admin".into() },
        ];
        let mapped = to_organization_user(user("abc", "jane"), &held);

        assert_eq!(mapped.roles, vec!["shift-admin", "shift-viewer"]);
        assert_eq!(mapped.username.as_deref(), Some("jane"));
    }

    #[test]
    fn members_are_listed_by_name_case_insensitively() {
        let listed = sorted(vec![
            to_organization_user(user("1", "zoe"), &[]),
            to_organization_user(user("2", "Anna"), &[]),
            to_organization_user(user("3", "mark"), &[]),
        ]);

        assert_eq!(
            listed.iter().map(|u| u.username.clone().unwrap()).collect::<Vec<_>>(),
            vec!["Anna", "mark", "zoe"]
        );
    }

    #[test]
    fn blank_names_are_dropped_rather_than_stored_as_empty() {
        assert_eq!(non_empty(Some("  Jane ")), Some("Jane".to_string()));
        assert_eq!(non_empty(Some("   ")), None);
        assert_eq!(non_empty(None), None);
    }
}
