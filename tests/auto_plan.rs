//! End-to-end tests for the automatic-planning schedule in the planner settings.
//!
//! The schedule is off by default, validated on the way in, and its status fields
//! belong to the job: a `PUT` can neither set nor move them. These drive the real
//! router over real HTTP with a signed access token (see `common`).
//!
//! Each test works in its own throwaway tenant. Needs PostgreSQL; when no database
//! is reachable the tests print a notice and pass, as in `planner_settings.rs`.

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
                eprintln!("skipping auto-plan tests: no database ({e})");
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
            tenant: format!("test-autoplan-{}", Uuid::new_v4()),
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


    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(audit_logs::table.filter(audit_logs::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(planner_settings::table)
            .filter(planner_settings::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
    }
}


fn settings_body() -> Value {
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
    })
}

fn with(mut body: Value, extra: Value) -> Value {
    for (k, v) in extra.as_object().expect("object") {
        body[k] = v.clone();
    }
    body
}

#[tokio::test]
async fn automatic_planning_is_off_by_default() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, body) = app.get().await;
    assert_eq!(status, 200, "body: {body}");
    assert_eq!(body["auto_plan_enabled"], false);
    assert_eq!(body["auto_plan_every_weeks"], 4);
    assert_eq!(body["auto_plan_weekday"], 0);
    assert_eq!(body["auto_plan_time"], "02:00");
    assert_eq!(body["auto_plan_start_date"], Value::Null);
    assert_eq!(body["auto_plan_range_unit"], "weeks");
    assert_eq!(body["auto_plan_range_count"], 4);
    assert_eq!(body["auto_plan_next_run"], Value::Null, "nothing is scheduled while it is off");
    assert_eq!(body["auto_plan_last_outcome"], Value::Null);

    app.cleanup();
}

#[tokio::test]
async fn a_valid_schedule_round_trips_and_shows_its_next_run() {
    let Some(app) = TestApp::spawn().await else { return };

    let schedule = json!({
        "auto_plan_enabled": true,
        "auto_plan_every_weeks": 2,
        "auto_plan_weekday": 3,
        "auto_plan_time": "05:30",
        "auto_plan_start_date": "2099-01-01",
        "auto_plan_range_unit": "months",
        "auto_plan_range_count": 2,
    });
    let (status, body) = app.put(with(settings_body(), schedule)).await;
    assert_eq!(status, 200, "body: {body}");

    let (_, reread) = app.get().await;
    assert_eq!(reread["auto_plan_enabled"], true);
    assert_eq!(reread["auto_plan_every_weeks"], 2);
    assert_eq!(reread["auto_plan_weekday"], 3);
    assert_eq!(reread["auto_plan_time"], "05:30");
    assert_eq!(reread["auto_plan_start_date"], "2099-01-01");
    assert_eq!(reread["auto_plan_range_unit"], "months");
    assert_eq!(reread["auto_plan_range_count"], 2);
    // 2099-01-01 is a Thursday (weekday 3), the first run day of the cycle.
    assert_eq!(reread["auto_plan_next_run"], "2099-01-01T05:30:00");

    app.cleanup();
}

#[tokio::test]
async fn a_request_without_schedule_fields_keeps_the_stored_schedule() {
    let Some(app) = TestApp::spawn().await else { return };

    let schedule = json!({
        "auto_plan_enabled": true,
        "auto_plan_every_weeks": 6,
        "auto_plan_start_date": "2099-01-01",
    });
    assert_eq!(app.put(with(settings_body(), schedule)).await.0, 200);
    // An older UI that knows nothing of the schedule saves other settings.
    assert_eq!(app.put(settings_body()).await.0, 200);

    let (_, reread) = app.get().await;
    assert_eq!(reread["auto_plan_enabled"], true);
    assert_eq!(reread["auto_plan_every_weeks"], 6);
    assert_eq!(reread["auto_plan_start_date"], "2099-01-01");

    // `null` clears the start date, which a running schedule cannot do without.
    let (status, _) = app.put(with(settings_body(), json!({ "auto_plan_start_date": null }))).await;
    assert_eq!(status, 400);
    let (status, _) =
        app.put(with(settings_body(), json!({ "auto_plan_enabled": false, "auto_plan_start_date": null }))).await;
    assert_eq!(status, 200);
    let (_, cleared) = app.get().await;
    assert_eq!(cleared["auto_plan_start_date"], Value::Null);

    app.cleanup();
}

#[tokio::test]
async fn an_invalid_schedule_is_a_400_and_changes_nothing() {
    let Some(app) = TestApp::spawn().await else { return };

    let valid = json!({ "auto_plan_enabled": true, "auto_plan_start_date": "2099-01-01", "auto_plan_every_weeks": 3 });
    assert_eq!(app.put(with(settings_body(), valid)).await.0, 200);

    let invalid = [
        json!({ "auto_plan_every_weeks": 0 }),
        json!({ "auto_plan_every_weeks": 13 }),
        json!({ "auto_plan_weekday": 7 }),
        json!({ "auto_plan_weekday": -1 }),
        json!({ "auto_plan_time": "25:00" }),
        json!({ "auto_plan_time": "soon" }),
        json!({ "auto_plan_start_date": "next monday" }),
        json!({ "auto_plan_range_unit": "weeks", "auto_plan_range_count": 3 }),
        json!({ "auto_plan_range_unit": "weeks", "auto_plan_range_count": 1 }),
        json!({ "auto_plan_range_unit": "months", "auto_plan_range_count": 4 }),
        json!({ "auto_plan_range_unit": "years", "auto_plan_range_count": 1 }),
    ];
    for extra in invalid {
        let (status, body) = app.put(with(settings_body(), extra.clone())).await;
        assert_eq!(status, 400, "{extra} should be refused, got {body}");
    }

    let (_, after) = app.get().await;
    assert_eq!(after["auto_plan_every_weeks"], 3, "a refused request changes nothing");
    assert_eq!(after["auto_plan_weekday"], 0);
    assert_eq!(after["auto_plan_time"], "02:00");

    app.cleanup();
}

#[tokio::test]
async fn switching_on_needs_a_start_date() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, body) = app.put(with(settings_body(), json!({ "auto_plan_enabled": true }))).await;
    assert_eq!(status, 400, "body: {body}");
    let (_, after) = app.get().await;
    assert_eq!(after["auto_plan_enabled"], false);

    app.cleanup();
}

#[tokio::test]
async fn a_viewer_cannot_change_the_schedule() {
    let Some(app) = TestApp::spawn().await else { return };

    let schedule = json!({ "auto_plan_enabled": true, "auto_plan_start_date": "2099-01-01" });
    let (status, _) = app.put_as("shift-viewer", with(settings_body(), schedule)).await;
    assert!(status == 401 || status == 403, "got {status}");
    let (_, after) = app.get().await;
    assert_eq!(after["auto_plan_enabled"], false);

    app.cleanup();
}

#[tokio::test]
async fn status_fields_in_a_request_are_ignored() {
    let Some(app) = TestApp::spawn().await else { return };

    let sneaky = json!({
        "auto_plan_last_run_on": "2099-01-01",
        "auto_plan_last_outcome": "taken_over",
        "auto_plan_last_note": "forged",
        "auto_plan_next_run": "2099-01-01T00:00:00",
    });
    let (status, body) = app.put(with(settings_body(), sneaky)).await;
    assert_eq!(status, 200, "body: {body}");
    let (_, after) = app.get().await;
    assert_eq!(after["auto_plan_last_run_on"], Value::Null);
    assert_eq!(after["auto_plan_last_outcome"], Value::Null);
    assert_eq!(after["auto_plan_last_note"], Value::Null);

    app.cleanup();
}

#[tokio::test]
async fn only_a_schedule_change_re_arms_the_schedule() {
    let Some(app) = TestApp::spawn().await else { return };

    let on = json!({ "auto_plan_enabled": true, "auto_plan_start_date": "2099-01-01" });
    assert_eq!(app.put(with(settings_body(), on.clone())).await.0, 200);
    let armed = |app: &TestApp| -> Option<chrono::NaiveDateTime> {
        let mut conn = app.pool.get().expect("connection");
        planner_settings::table
            .filter(planner_settings::tenant_id.eq(&app.tenant))
            .select(planner_settings::auto_plan_armed_at)
            .first::<Option<chrono::NaiveDateTime>>(&mut conn)
            .expect("row")
    };
    let first = armed(&app);
    assert!(first.is_some(), "switching on arms the schedule");

    tokio::time::sleep(Duration::from_millis(1100)).await;
    let mut other = with(settings_body(), on.clone());
    other["wish_weight"] = json!(123);
    assert_eq!(app.put(other).await.0, 200);
    assert_eq!(armed(&app), first, "an unrelated setting must not re-arm the schedule");

    let moved = with(settings_body(), json!({ "auto_plan_weekday": 2 }));
    assert_eq!(app.put(moved).await.0, 200);
    assert!(armed(&app) > first, "a schedule change re-arms it");

    app.cleanup();
}
