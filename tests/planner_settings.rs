//! End-to-end tests for the planner settings' minimum-staffing mode.
//!
//! The mode decides whether the optimizer treats `min_employees` as a target it
//! may miss or a requirement it may not, so it has to survive the whole round
//! trip — request body, database column, response — unchanged. These drive the
//! real router over real HTTP with a signed access token (see `common`), the
//! same path a request from the gateway takes.
//!
//! Each test works in its own throwaway tenant and deletes its row afterwards.
//! Needs PostgreSQL; point `DATABASE_URL` at it, or leave it unset to use the
//! development default. When no database is reachable the tests print a notice
//! and pass rather than failing, matching `wish_window.rs`.

mod common;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::{json, Value};
use uuid::Uuid;

use common::TestKeys;
use shift::database::DbPool;
use shift::repository::AppState;
use shift::schema::{audit_logs, planner_settings};

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

struct TestApp {
    base_url: String,
    tenant: String,
    keys: TestKeys,
    pool: DbPool,
}

impl TestApp {
    async fn spawn() -> Option<Self> {
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
        let manager = ConnectionManager::<PgConnection>::new(url);
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(manager)
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping planner-settings tests: no database ({e})");
                return None;
            }
        };
        shift::database::run_migrations(&pool).expect("migrations");

        let keys = TestKeys::serve().await;
        let mut state = AppState::new(Arc::new(pool.clone()));
        state.token_verifier = Some(keys.verifier());
        let app = shift::server::create_router(state);
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        Some(Self {
            base_url: format!("http://{addr}/api/v1"),
            tenant: format!("test-planner-{}", Uuid::new_v4()),
            keys,
            pool,
        })
    }

    fn token(&self) -> String {
        self.token_as("shift-planner")
    }

    fn token_as(&self, role: &str) -> String {
        self.keys.sign(json!({
            "sub": format!("{role}@test.invalid"),
            "tenant": [self.tenant],
            "realm_access": { "roles": [role] },
            "email": format!("{role}@test.invalid"),
            "preferred_username": format!("{role}@test.invalid"),
        }))
    }

    async fn get(&self) -> (u16, Value) {
        let response = reqwest::Client::new()
            .get(format!("{}/planner-settings", self.base_url))
            .header("x-access-token", self.token())
            .send()
            .await
            .expect("GET planner-settings");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn put(&self, body: Value) -> (u16, Value) {
        let response = reqwest::Client::new()
            .put(format!("{}/planner-settings", self.base_url))
            .header("x-access-token", self.token())
            .json(&body)
            .send()
            .await
            .expect("PUT planner-settings");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn put_as(&self, role: &str, body: Value) -> (u16, Value) {
        let response = reqwest::Client::new()
            .put(format!("{}/planner-settings", self.base_url))
            .header("x-access-token", self.token_as(role))
            .json(&body)
            .send()
            .await
            .expect("PUT planner-settings");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    /// The `changes` of every settings update audited for this tenant, oldest first.
    fn audited_updates(&self) -> Vec<Value> {
        let mut conn = self.pool.get().expect("connection");
        audit_logs::table
            .filter(audit_logs::tenant_id.eq(&self.tenant))
            .filter(audit_logs::action.eq("planner_settings.update"))
            .order(audit_logs::created_at.asc())
            .select(audit_logs::changes)
            .load::<Option<String>>(&mut conn)
            .expect("audit rows")
            .into_iter()
            .filter_map(|c| serde_json::from_str(&c?).ok())
            .collect()
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(audit_logs::table.filter(audit_logs::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(planner_settings::table)
            .filter(planner_settings::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
    }
}

/// Everything the endpoint requires, so a test can vary one field at a time.
fn settings_body(min_staffing_mode: Value) -> Value {
    json!({
        "night_shift_recovery_days": 2,
        "min_rest_hours": 11.0,
        "max_consecutive_days": 6,
        "max_working_days_per_week": 5,
        "equality_weight": 50000,
        "priority_weights": { "high": 10000, "medium": 1000, "low": 100 },
        "monthly_hours_target_weight": 1000,
        "solver_time_limit_seconds": 120.0,
        "solver_num_workers": 8,
        "min_staffing_mode": min_staffing_mode,
    })
}

#[tokio::test]
async fn a_new_tenant_starts_with_minimum_staffing_as_a_target() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, body) = app.get().await;
    assert_eq!(status, 200, "body: {body}");
    assert_eq!(
        body["min_staffing_mode"], "soft",
        "a tenant that never chose must keep getting a plan, understaffed or not"
    );

    app.cleanup();
}

#[tokio::test]
async fn the_minimum_staffing_mode_survives_the_round_trip() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, body) = app.put(settings_body(json!("hard"))).await;
    assert_eq!(status, 200, "body: {body}");
    assert_eq!(body["min_staffing_mode"], "hard");

    let (_, reread) = app.get().await;
    assert_eq!(reread["min_staffing_mode"], "hard", "stored, not just echoed");

    let (_, back) = app.put(settings_body(json!("soft"))).await;
    assert_eq!(back["min_staffing_mode"], "soft", "and it can be switched back");

    app.cleanup();
}

#[tokio::test]
async fn an_omitted_minimum_staffing_mode_stays_a_target() {
    let Some(app) = TestApp::spawn().await else { return };

    let mut body = settings_body(json!("hard"));
    body.as_object_mut().unwrap().remove("min_staffing_mode");

    let (status, response) = app.put(body).await;
    assert_eq!(status, 200, "body: {response}");
    assert_eq!(
        response["min_staffing_mode"], "soft",
        "an older client that does not send the field must not make plans infeasible"
    );

    app.cleanup();
}

#[tokio::test]
async fn an_unknown_minimum_staffing_mode_is_refused() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, _) = app.put(settings_body(json!("mandatory"))).await;
    assert!(
        (400..500).contains(&status),
        "expected a client error for an unknown mode, got {status}"
    );

    let (_, body) = app.get().await;
    assert_eq!(body["min_staffing_mode"], "soft", "the rejected write changed nothing");

    app.cleanup();
}

#[tokio::test]
async fn rotations_are_kept_until_switched_off() {
    let Some(app) = TestApp::spawn().await else { return };

    let (_, body) = app.get().await;
    assert_eq!(body["keep_fixed_assignments"], true, "a new tenant keeps its rotations");

    let mut off = settings_body(json!("soft"));
    off["keep_fixed_assignments"] = json!(false);
    let (status, body) = app.put(off).await;
    assert_eq!(status, 200, "body: {body}");
    assert_eq!(body["keep_fixed_assignments"], false);
    let (_, reread) = app.get().await;
    assert_eq!(reread["keep_fixed_assignments"], false, "stored, not just echoed");

    // An older client that does not know the field switches rotations back on
    // rather than silently leaving them off — the same rule as every other
    // omitted setting: omitted means default.
    let (_, omitted) = app.put(settings_body(json!("soft"))).await;
    assert_eq!(omitted["keep_fixed_assignments"], true);

    app.cleanup();
}

#[tokio::test]
async fn the_roster_lifecycle_settings_round_trip_with_their_defaults() {
    let Some(app) = TestApp::spawn().await else { return };

    let (_, body) = app.get().await;
    assert_eq!(body["publish_lead_days"], 28);
    assert_eq!(body["freeze_days"], 7);
    assert_eq!(body["change_weight"], 100000);

    let mut changed = settings_body(json!("soft"));
    changed["publish_lead_days"] = json!(21);
    changed["freeze_days"] = json!(0);
    changed["change_weight"] = json!(0);
    let (status, body) = app.put(changed).await;
    assert_eq!(status, 200, "body: {body}");
    let (_, reread) = app.get().await;
    assert_eq!(reread["publish_lead_days"], 21, "stored, not just echoed");
    assert_eq!(reread["freeze_days"], 0, "0 switches the freeze window off");
    assert_eq!(reread["change_weight"], 0, "0 lets a re-solve ignore the published roster");

    // Omitted means default, as for every other setting.
    let (_, omitted) = app.put(settings_body(json!("soft"))).await;
    assert_eq!(omitted["publish_lead_days"], 28);
    assert_eq!(omitted["freeze_days"], 7);
    assert_eq!(omitted["change_weight"], 100000);

    app.cleanup();
}

#[tokio::test]
async fn negative_roster_lifecycle_settings_are_refused() {
    let Some(app) = TestApp::spawn().await else { return };

    for field in ["publish_lead_days", "freeze_days", "change_weight"] {
        let mut body = settings_body(json!("soft"));
        body[field] = json!(-1);
        let (status, response) = app.put(body).await;
        assert_eq!(status, 400, "{field} = -1 must be refused, got {status}: {response}");
    }
    let (_, body) = app.get().await;
    assert_eq!(body["freeze_days"], 7, "the rejected writes changed nothing");

    app.cleanup();
}

#[tokio::test]
async fn the_labor_law_profile_round_trips_and_is_checked() {
    let Some(app) = TestApp::spawn().await else { return };

    let (_, body) = app.get().await;
    assert_eq!(body["labor_law_profile"], "none", "no legal rules until a planner picks a profile");
    assert_eq!(body["labor_law_averaging_weeks"], 24);

    let mut changed = settings_body(json!("soft"));
    changed["labor_law_profile"] = json!("arbzg_de");
    changed["labor_law_averaging_weeks"] = json!(16);
    let (status, body) = app.put(changed).await;
    assert_eq!(status, 200, "body: {body}");
    let (_, reread) = app.get().await;
    assert_eq!(reread["labor_law_profile"], "arbzg_de", "stored, not just echoed");
    assert_eq!(reread["labor_law_averaging_weeks"], 16);

    for (field, value) in [
        ("labor_law_profile", json!("arbzg_at")),
        ("labor_law_averaging_weeks", json!(0)),
        ("labor_law_averaging_weeks", json!(53)),
    ] {
        let mut body = settings_body(json!("soft"));
        body[field] = value.clone();
        let (status, response) = app.put(body).await;
        assert_eq!(status, 400, "{field} = {value} must be refused, got {status}: {response}");
    }
    let (_, body) = app.get().await;
    assert_eq!(body["labor_law_profile"], "arbzg_de", "the rejected writes changed nothing");

    app.cleanup();
}

// ── The selected use case ───────────────────────────────────────────────────

#[tokio::test]
async fn a_new_tenant_has_no_use_case() {
    let Some(app) = TestApp::spawn().await else { return };
    let (status, body) = app.get().await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["use_case"], Value::Null, "nothing is chosen until a planner chooses");
    app.cleanup();
}

#[tokio::test]
async fn a_use_case_is_stored_together_with_the_values_it_filled_in() {
    let Some(app) = TestApp::spawn().await else { return };

    let mut body = settings_body(json!("soft"));
    body["equality_weight"] = json!(120000); // what the "Equal share" use case sets
    body["use_case"] = json!("fairness");
    let (status, saved) = app.put(body).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["use_case"], "fairness");

    let (_, reread) = app.get().await;
    assert_eq!((reread["use_case"].as_str(), reread["equality_weight"].as_i64()), (Some("fairness"), Some(120000)), "stored, not just echoed");
    app.cleanup();
}

#[tokio::test]
async fn an_omitted_use_case_keeps_the_stored_one_and_null_clears_it() {
    let Some(app) = TestApp::spawn().await else { return };

    let mut with = settings_body(json!("soft"));
    with["use_case"] = json!("wellbeing");
    assert_eq!(app.put(with).await.0, 200);

    // A client that does not know the field (an old UI, a script) changes nothing.
    let mut other_values = settings_body(json!("soft"));
    other_values["equality_weight"] = json!(70000);
    let (status, saved) = app.put(other_values).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["use_case"], "wellbeing", "omitted keeps");
    assert_eq!(saved["equality_weight"], 70000, "the values were saved all the same");

    let mut cleared = settings_body(json!("soft"));
    cleared["use_case"] = Value::Null;
    let (status, saved) = app.put(cleared).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["use_case"], Value::Null, "null clears");
    assert_eq!(app.get().await.1["use_case"], Value::Null);
    app.cleanup();
}

#[tokio::test]
async fn an_invalid_use_case_is_refused_and_changes_nothing() {
    let Some(app) = TestApp::spawn().await else { return };

    let mut chosen = settings_body(json!("soft"));
    chosen["use_case"] = json!("balanced");
    assert_eq!(app.put(chosen).await.0, 200);

    for bad in [json!("Equal Share!"), json!(""), json!("a".repeat(41)), json!("Fairness"), json!("wishes first"), json!(7)] {
        let mut body = settings_body(json!("soft"));
        body["equality_weight"] = json!(1);
        body["use_case"] = bad.clone();
        let (status, response) = app.put(body).await;
        assert_eq!(status, 400, "use_case {bad} must be refused, got {status}: {response}");
    }
    let (_, now) = app.get().await;
    assert_eq!(now["use_case"], "balanced");
    assert_eq!(now["equality_weight"], 50000, "the refused writes saved nothing");

    let mut longest = settings_body(json!("soft"));
    longest["use_case"] = json!("a".repeat(40));
    assert_eq!(app.put(longest).await.0, 200, "forty characters are fine");
    app.cleanup();
}

#[tokio::test]
async fn a_viewer_cannot_change_the_use_case() {
    let Some(app) = TestApp::spawn().await else { return };

    let mut chosen = settings_body(json!("soft"));
    chosen["use_case"] = json!("coverage");
    assert_eq!(app.put(chosen).await.0, 200);

    let mut attempt = settings_body(json!("soft"));
    attempt["use_case"] = json!("stability");
    let (status, _) = app.put_as("shift-viewer", attempt).await;
    assert_eq!(status, 403);
    assert_eq!(app.get().await.1["use_case"], "coverage");
    app.cleanup();
}

#[tokio::test]
async fn a_change_of_use_case_is_in_the_audit_entry() {
    let Some(app) = TestApp::spawn().await else { return };

    let mut first = settings_body(json!("soft"));
    first["use_case"] = json!("balanced");
    assert_eq!(app.put(first).await.0, 200);
    let mut second = settings_body(json!("soft"));
    second["use_case"] = json!("wellbeing");
    assert_eq!(app.put(second).await.0, 200);

    let audited = app.audited_updates();
    assert_eq!(audited.len(), 2, "{audited:?}");
    assert_eq!(audited[0]["use_case"], "balanced");
    assert_eq!(audited[1]["use_case"], "wellbeing", "the new state carries the new use case, so the diff shows it");
    app.cleanup();
}
