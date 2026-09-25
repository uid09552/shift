//! End-to-end tests for employees' personal limits: the round trip through
//! `/employees/{id}/personal-limits`, validation, and that `/planner/prepare`
//! hands them to the optimizer together with `personal_limits_mode`.
//!
//! Each test works in its own throwaway tenant and deletes what it created.
//! Needs PostgreSQL (see `rotation_patterns.rs`, whose harness this mirrors);
//! without one the tests print a notice and pass.

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
use shift::schema::{audit_logs, employee_shift_assignments, employees, rotation_patterns, shifts, workstations};

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

struct TestApp {
    base_url: String,
    tenant: String,
    pool: DbPool,
}

impl TestApp {
    async fn spawn() -> Option<Self> {
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(ConnectionManager::<PgConnection>::new(url))
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping personal-limits tests: no database ({e})");
                return None;
            }
        };
        shift::database::run_migrations(&pool).expect("migrations");

        let app = shift::server::create_router(AppState::new(Arc::new(pool.clone())));
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        Some(Self {
            base_url: format!("http://{addr}/api/v1"),
            tenant: format!("test-personal-limits-{}", Uuid::new_v4()),
            pool,
        })
    }

    fn token(&self) -> String {
        let payload = json!({
            "tenant": [self.tenant],
            "realm_access": { "roles": ["shift-planner"] },
            "email": "planner@test.invalid",
        });
        let encode = |bytes: &[u8]| general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        format!(
            "{}.{}.signature",
            encode(br#"{"alg":"RS256","typ":"JWT"}"#),
            encode(payload.to_string().as_bytes()),
        )
    }

    async fn call(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> (u16, Value) {
        let mut request = reqwest::Client::new()
            .request(method, format!("{}{}", self.base_url, path))
            .header("x-access-token", self.token());
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn create(&self, path: &str, body: Value) -> String {
        let (status, body) = self.call(reqwest::Method::POST, path, Some(body)).await;
        assert_eq!(status, 200, "POST {path}: {body}");
        body["id"].as_str().expect("id").to_string()
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(employee_shift_assignments::table)
            .filter(employee_shift_assignments::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(rotation_patterns::table)
            .filter(rotation_patterns::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(employees::table)
            .filter(employees::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(workstations::table)
            .filter(workstations::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(shifts::table)
            .filter(shifts::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(audit_logs::table)
            .filter(audit_logs::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
    }
}

#[tokio::test]
async fn personal_limits_round_trip_and_reach_the_optimizer() {
    let Some(app) = TestApp::spawn().await else { return };
    let night = app.create("/shifts", json!({ "name": "Night", "short_name": "N", "color": "#6366F1" })).await;
    app.create("/workstations", json!({ "name": "Ward", "available": true, "active_shift_ids": [night] })).await;
    let email = format!("anna-{}@test.invalid", Uuid::new_v4());
    let anna = app.create("/employees", json!({ "name": "Anna", "email": email, "monthly_working_hours": 160 })).await;
    let path = format!("/employees/{anna}/personal-limits");

    // No row yet: no limits.
    let (status, empty) = app.call(reqwest::Method::GET, &path, None).await;
    assert_eq!(status, 200, "{empty}");
    assert_eq!(empty["max_nights_per_month"], Value::Null);
    assert_eq!(empty["no_night_shifts"], false);
    assert_eq!(empty["preferred_days_off"], json!([]));

    let (status, saved) = app
        .call(
            reqwest::Method::PUT,
            &path,
            Some(json!({ "max_nights_per_month": 4, "max_weekends_per_month": 2, "preferred_days_off": [6, 2, 2] })),
        )
        .await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["preferred_days_off"], json!([2, 6]), "sorted and de-duplicated");

    let (_, reread) = app.call(reqwest::Method::GET, &path, None).await;
    assert_eq!(reread["max_nights_per_month"], 4, "stored, not just echoed");
    assert_eq!(reread["max_weekends_per_month"], 2);

    let (status, prepared) = app
        .call(
            reqwest::Method::POST,
            "/planner/prepare",
            Some(json!({ "start_date": "2026-10-01", "end_date": "2026-10-31" })),
        )
        .await;
    assert_eq!(status, 200, "{prepared}");
    let employee = prepared["employees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == anna.as_str())
        .expect("Anna in the payload")
        .clone();
    assert_eq!(employee["max_nights_per_month"], 4);
    assert_eq!(employee["max_weekends_per_month"], 2);
    assert_eq!(employee["preferred_days_off"], json!(["2", "6"]), "the solver's weekday format");
    assert_eq!(prepared["constraints"]["personal_limits_mode"], "hard", "the default");

    // Replaced as a whole: an empty body clears every limit.
    let (status, cleared) = app.call(reqwest::Method::PUT, &path, Some(json!({}))).await;
    assert_eq!(status, 200);
    assert_eq!(cleared["max_nights_per_month"], Value::Null);
    assert_eq!(cleared["preferred_days_off"], json!([]));

    app.cleanup();
}

#[tokio::test]
async fn impossible_limits_and_unknown_employees_are_refused() {
    let Some(app) = TestApp::spawn().await else { return };
    let email = format!("ben-{}@test.invalid", Uuid::new_v4());
    let ben = app.create("/employees", json!({ "name": "Ben", "email": email, "monthly_working_hours": 160 })).await;
    let path = format!("/employees/{ben}/personal-limits");

    for body in [
        json!({ "max_nights_per_month": 32 }),
        json!({ "max_weekends_per_month": 6 }),
        json!({ "preferred_days_off": [7] }),
    ] {
        let (status, answer) = app.call(reqwest::Method::PUT, &path, Some(body.clone())).await;
        assert_eq!(status, 400, "{body} -> {answer}");
    }

    let unknown = format!("/employees/{}/personal-limits", Uuid::new_v4());
    let (status, _) = app.call(reqwest::Method::GET, &unknown, None).await;
    assert_eq!(status, 404);
    let (status, _) = app.call(reqwest::Method::PUT, &unknown, Some(json!({ "no_night_shifts": true }))).await;
    assert_eq!(status, 404);

    app.cleanup();
}
