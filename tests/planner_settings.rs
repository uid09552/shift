//! End-to-end tests for the planner settings' minimum-staffing mode.
//!
//! The mode decides whether the optimizer treats `min_employees` as a target it
//! may miss or a requirement it may not, so it has to survive the whole round
//! trip — request body, database column, response — unchanged. These drive the
//! real router over real HTTP with a forged access token, the same path a
//! request from the gateway takes.
//!
//! Each test works in its own throwaway tenant and deletes its row afterwards.
//! Needs PostgreSQL; point `DATABASE_URL` at it, or leave it unset to use the
//! development default. When no database is reachable the tests print a notice
//! and pass rather than failing, matching `wish_window.rs`.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::{json, Value};
use uuid::Uuid;

use shift::database::DbPool;
use shift::repository::AppState;
use shift::schema::planner_settings;

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

struct TestApp {
    base_url: String,
    tenant: String,
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

        let state = AppState::new(Arc::new(pool.clone()));
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
            pool,
        })
    }

    fn token(&self) -> String {
        let payload = json!({
            "tenant": [self.tenant],
            "realm_access": { "roles": ["shift-planner"] },
            "email": "planner@test.invalid",
            "preferred_username": "planner@test.invalid",
        });
        let encode = |bytes: &[u8]| general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        format!(
            "{}.{}.signature",
            encode(br#"{"alg":"RS256","typ":"JWT"}"#),
            encode(payload.to_string().as_bytes()),
        )
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

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
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
