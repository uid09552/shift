//! Thin client for the parts of the Keycloak Admin REST API the user-management
//! endpoints need: the members of an organization, the realm roles a user holds,
//! and the calls that change either.
//!
//! Authentication is the `shift-gateway` service account (client credentials).
//! The realm import grants it the `realm-management` roles those calls require —
//! see `deploy/iam/realm-shift.json`.
//!
//! A tenant here *is* a Keycloak organization: the `tenant` claim the gateway puts
//! in the access token is the organization's alias (see `services::tenant`), so the
//! caller's tenant is the only organization these calls ever touch.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::errors::AppError;

/// Where Keycloak is and which client to authenticate as.
#[derive(Debug, Clone)]
pub struct KeycloakSettings {
    /// Base URL including Keycloak's relative path, e.g. `http://localhost:8080/auth`.
    pub url: String,
    pub realm: String,
    pub client_id: String,
    pub client_secret: String,
}

/// A user as Keycloak represents it. Only the fields the UI shows are mapped;
/// everything else in the representation is ignored, and left untouched on update.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeycloakUser {
    pub id: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// A realm role, as the role-mapping endpoints want it: assigning and unassigning
/// both take the full representation, not just the name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealmRole {
    pub id: String,
    pub name: String,
}

/// A Keycloak organization — one per tenant, keyed by its alias.
#[derive(Debug, Clone, Deserialize)]
pub struct Organization {
    pub id: String,
    pub alias: String,
}

/// What to create a user with. `password` is optional: without one the account
/// exists but cannot be logged into until an admin (or a reset mail) sets one.
#[derive(Debug, Clone)]
pub struct NewUser {
    pub username: String,
    pub email: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub enabled: bool,
    pub password: Option<String>,
    /// Whether the password must be changed at first login.
    pub temporary_password: bool,
}

/// A service-account token and when it stops being usable. Refreshed a little
/// before it actually expires so an in-flight request cannot age out mid-call.
struct CachedToken {
    value: String,
    expires_at: Instant,
}

pub struct KeycloakAdmin {
    settings: KeycloakSettings,
    http: reqwest::Client,
    token: RwLock<Option<CachedToken>>,
}

impl KeycloakAdmin {
    pub fn new(mut settings: KeycloakSettings) -> Self {
        settings.url = settings.url.trim_end_matches('/').to_string();
        Self {
            settings,
            http: reqwest::Client::new(),
            token: RwLock::new(None),
        }
    }

    /// Whether the settings name a Keycloak to talk to at all. Everything is
    /// optional in the config, so a deployment without user management just
    /// leaves them empty.
    pub fn is_configured(settings: &KeycloakSettings) -> bool {
        !settings.url.trim().is_empty()
            && !settings.realm.trim().is_empty()
            && !settings.client_id.trim().is_empty()
    }

    pub fn realm(&self) -> &str {
        &self.settings.realm
    }

    // ── Organizations ────────────────────────────────────────────────────────

    /// The organization whose alias is `alias` — i.e. the caller's tenant.
    /// Keycloak's `search` is a substring match over name and alias, so the exact
    /// alias is picked out of the result rather than trusting the first hit.
    pub async fn find_organization(&self, alias: &str) -> Result<Organization, AppError> {
        let orgs: Vec<Organization> = self
            .send(
                self.http
                    .get(self.admin_url("organizations"))
                    .query(&[("search", alias), ("first", "0"), ("max", "100")]),
            )
            .await?;

        orgs.into_iter()
            .find(|o| o.alias == alias)
            .ok_or_else(|| {
                AppError::Unavailable(format!(
                    "No Keycloak organization with alias '{alias}' in realm '{}' — the tenant \
                     exists in the token but not in the realm",
                    self.settings.realm
                ))
            })
    }

    pub async fn list_organization_members(&self, org_id: &str) -> Result<Vec<KeycloakUser>, AppError> {
        self.send(
            self.http
                .get(self.admin_url(&format!("organizations/{org_id}/members")))
                .query(&[("first", "0"), ("max", "1000")]),
        )
        .await
    }

    /// Whether `user_id` is already a member. Membership is what scopes a user to a
    /// tenant, so every read and write checks it before touching the user.
    pub async fn is_organization_member(&self, org_id: &str, user_id: &str) -> Result<bool, AppError> {
        let members = self.list_organization_members(org_id).await?;
        Ok(members.iter().any(|m| m.id == user_id))
    }

    /// Adds an existing realm user to the organization. Keycloak takes the raw user
    /// id as the request body here, not JSON.
    pub async fn add_organization_member(&self, org_id: &str, user_id: &str) -> Result<(), AppError> {
        self.send_no_content(
            self.http
                .post(self.admin_url(&format!("organizations/{org_id}/members")))
                .header("content-type", "text/plain")
                .body(user_id.to_string()),
        )
        .await
    }

    /// Removes the user from the organization. The realm account itself stays —
    /// it may belong to other organizations.
    pub async fn remove_organization_member(&self, org_id: &str, user_id: &str) -> Result<(), AppError> {
        self.send_no_content(
            self.http
                .delete(self.admin_url(&format!("organizations/{org_id}/members/{user_id}"))),
        )
        .await
    }

    // ── Users ────────────────────────────────────────────────────────────────

    pub async fn get_user(&self, user_id: &str) -> Result<KeycloakUser, AppError> {
        self.send(self.http.get(self.admin_url(&format!("users/{user_id}"))))
            .await
    }

    /// Users whose username or e-mail matches `term` exactly. Used to tell a
    /// "create" apart from an "invite an account that already exists".
    pub async fn find_users_exact(&self, term: &str) -> Result<Vec<KeycloakUser>, AppError> {
        let by_username: Vec<KeycloakUser> = self
            .send(
                self.http
                    .get(self.admin_url("users"))
                    .query(&[("username", term), ("exact", "true")]),
            )
            .await?;
        let by_email: Vec<KeycloakUser> = self
            .send(
                self.http
                    .get(self.admin_url("users"))
                    .query(&[("email", term), ("exact", "true")]),
            )
            .await?;

        let mut users = by_username;
        for user in by_email {
            if !users.iter().any(|u| u.id == user.id) {
                users.push(user);
            }
        }
        Ok(users)
    }

    /// Creates a realm user and returns its id, which Keycloak only reports in the
    /// `Location` header of the 201.
    pub async fn create_user(&self, new_user: &NewUser) -> Result<String, AppError> {
        let mut body = serde_json::json!({
            "username": new_user.username,
            "enabled": new_user.enabled,
            "emailVerified": false,
        });
        if let Some(email) = &new_user.email {
            body["email"] = serde_json::Value::String(email.clone());
        }
        if let Some(first_name) = &new_user.first_name {
            body["firstName"] = serde_json::Value::String(first_name.clone());
        }
        if let Some(last_name) = &new_user.last_name {
            body["lastName"] = serde_json::Value::String(last_name.clone());
        }
        if let Some(password) = &new_user.password {
            body["credentials"] = serde_json::json!([{
                "type": "password",
                "value": password,
                "temporary": new_user.temporary_password,
            }]);
        }

        let response = self
            .execute(self.http.post(self.admin_url("users")).json(&body))
            .await?;
        let location = response
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        Self::check_status(response).await?;

        match location.as_deref().and_then(|l| l.rsplit('/').next()) {
            Some(id) if !id.is_empty() => Ok(id.to_string()),
            // Keycloak always sets Location on a 201; falling back to a lookup keeps
            // a proxy that strips the header from breaking user creation outright.
            _ => self
                .find_users_exact(&new_user.username)
                .await?
                .into_iter()
                .next()
                .map(|u| u.id)
                .ok_or_else(|| {
                    AppError::Unavailable(
                        "Keycloak created the user but reported no id for it".into(),
                    )
                }),
        }
    }

    pub async fn delete_user(&self, user_id: &str) -> Result<(), AppError> {
        self.send_no_content(self.http.delete(self.admin_url(&format!("users/{user_id}"))))
            .await
    }

    pub async fn set_user_enabled(&self, user_id: &str, enabled: bool) -> Result<(), AppError> {
        self.send_no_content(
            self.http
                .put(self.admin_url(&format!("users/{user_id}")))
                .json(&serde_json::json!({ "enabled": enabled })),
        )
        .await
    }

    // ── Realm roles ──────────────────────────────────────────────────────────

    /// Every realm role, so a name can be turned into the representation the
    /// role-mapping endpoints require.
    pub async fn list_realm_roles(&self) -> Result<Vec<RealmRole>, AppError> {
        self.send(
            self.http
                .get(self.admin_url("roles"))
                .query(&[("first", "0"), ("max", "500")]),
        )
        .await
    }

    pub async fn user_realm_roles(&self, user_id: &str) -> Result<Vec<RealmRole>, AppError> {
        self.send(
            self.http
                .get(self.admin_url(&format!("users/{user_id}/role-mappings/realm"))),
        )
        .await
    }

    pub async fn add_realm_roles(&self, user_id: &str, roles: &[RealmRole]) -> Result<(), AppError> {
        if roles.is_empty() {
            return Ok(());
        }
        self.send_no_content(
            self.http
                .post(self.admin_url(&format!("users/{user_id}/role-mappings/realm")))
                .json(roles),
        )
        .await
    }

    pub async fn remove_realm_roles(&self, user_id: &str, roles: &[RealmRole]) -> Result<(), AppError> {
        if roles.is_empty() {
            return Ok(());
        }
        self.send_no_content(
            self.http
                .delete(self.admin_url(&format!("users/{user_id}/role-mappings/realm")))
                .json(roles),
        )
        .await
    }

    // ── Plumbing ─────────────────────────────────────────────────────────────

    fn admin_url(&self, path: &str) -> String {
        format!("{}/admin/realms/{}/{}", self.settings.url, self.settings.realm, path)
    }

    /// A service-account access token, cached until shortly before it expires.
    async fn access_token(&self) -> Result<String, AppError> {
        if let Some(token) = self.token.read().await.as_ref() {
            if token.expires_at > Instant::now() {
                return Ok(token.value.clone());
            }
        }

        let mut cache = self.token.write().await;
        // Another task may have refreshed it while this one waited for the lock.
        if let Some(token) = cache.as_ref() {
            if token.expires_at > Instant::now() {
                return Ok(token.value.clone());
            }
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            #[serde(default)]
            expires_in: u64,
        }

        let url = format!(
            "{}/realms/{}/protocol/openid-connect/token",
            self.settings.url, self.settings.realm
        );
        let response = self
            .http
            .post(&url)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", self.settings.client_id.as_str()),
                ("client_secret", self.settings.client_secret.as_str()),
            ])
            .send()
            .await
            .map_err(|e| AppError::Unavailable(format!("Keycloak is not reachable at {url}: {e}")))?;

        let response = Self::check_status(response).await?;
        let token: TokenResponse = response.json().await.map_err(|e| {
            AppError::Unavailable(format!("Keycloak returned an unreadable token response: {e}"))
        })?;

        // Refresh 30s early, and never trust a missing/absurd lifetime.
        let lifetime = token.expires_in.clamp(30, 3600).saturating_sub(30);
        *cache = Some(CachedToken {
            value: token.access_token.clone(),
            expires_at: Instant::now() + Duration::from_secs(lifetime),
        });
        Ok(token.access_token)
    }

    async fn execute(&self, request: reqwest::RequestBuilder) -> Result<reqwest::Response, AppError> {
        let token = self.access_token().await?;
        request
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| AppError::Unavailable(format!("Keycloak admin API request failed: {e}")))
    }

    /// Sends a request and decodes the JSON body.
    async fn send<T: for<'de> Deserialize<'de>>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, AppError> {
        let response = Self::check_status(self.execute(request).await?).await?;
        response.json().await.map_err(|e| {
            AppError::Unavailable(format!("Keycloak returned an unreadable response: {e}"))
        })
    }

    /// Sends a request whose response body carries nothing worth reading.
    async fn send_no_content(&self, request: reqwest::RequestBuilder) -> Result<(), AppError> {
        Self::check_status(self.execute(request).await?).await?;
        Ok(())
    }

    /// Maps Keycloak's status codes onto ours, keeping its error message: it says
    /// things like "User exists with same username", which the UI can show as-is.
    async fn check_status(response: reqwest::Response) -> Result<reqwest::Response, AppError> {
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }

        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("errorMessage")
                    .or_else(|| v.get("error_description"))
                    .or_else(|| v.get("error"))
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.chars().take(300).collect());

        Err(match status {
            reqwest::StatusCode::NOT_FOUND => AppError::NotFound,
            reqwest::StatusCode::CONFLICT => AppError::Duplicate,
            reqwest::StatusCode::BAD_REQUEST => AppError::Validation(format!("Keycloak: {message}")),
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
                AppError::Unavailable(format!(
                    "Keycloak refused the service account ({status}): {message} — check the \
                     realm-management roles on the admin client's service account"
                ))
            }
            _ => AppError::Unavailable(format!("Keycloak admin API returned {status}: {message}")),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn admin() -> KeycloakAdmin {
        KeycloakAdmin::new(KeycloakSettings {
            url: "http://localhost:8080/auth/".to_string(),
            realm: "shift".to_string(),
            client_id: "shift-gateway".to_string(),
            client_secret: "secret".to_string(),
        })
    }

    #[test]
    fn admin_urls_do_not_double_up_slashes() {
        assert_eq!(
            admin().admin_url("users"),
            "http://localhost:8080/auth/admin/realms/shift/users"
        );
    }

    #[test]
    fn settings_without_a_url_are_not_configured() {
        let mut settings = KeycloakSettings {
            url: String::new(),
            realm: "shift".to_string(),
            client_id: "shift-gateway".to_string(),
            client_secret: String::new(),
        };
        assert!(!KeycloakAdmin::is_configured(&settings));

        settings.url = "http://localhost:8080/auth".to_string();
        // An empty secret is legitimate — a public admin client in a test realm.
        assert!(KeycloakAdmin::is_configured(&settings));

        settings.realm = "  ".to_string();
        assert!(!KeycloakAdmin::is_configured(&settings));
    }

    #[test]
    fn users_parse_from_keycloaks_camel_case() {
        let user: KeycloakUser = serde_json::from_value(serde_json::json!({
            "id": "3a9e23b8-4a00-478c-99b7-eb68df54bc40",
            "username": "nurse.jane",
            "email": "jane@hospital.example",
            "firstName": "Jane",
            "lastName": "Doe",
            "enabled": true,
            "somethingElse": 42
        }))
        .unwrap();

        assert_eq!(user.first_name.as_deref(), Some("Jane"));
        assert_eq!(user.last_name.as_deref(), Some("Doe"));
        assert!(user.enabled);
    }

    #[test]
    fn users_without_optional_fields_still_parse() {
        let user: KeycloakUser =
            serde_json::from_value(serde_json::json!({ "id": "abc" })).unwrap();
        assert_eq!(user.username, None);
        // Keycloak omits `enabled` on some representations; a member that exists is
        // not disabled just because the field was left out.
        assert!(user.enabled);
    }
}
