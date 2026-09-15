//! End-to-end tests for rotation patterns: a rhythm saved once and applied to
//! people as fixed assignments — shifts and days off — which the plan input
//! then carries to the optimizer.
//!
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
                eprintln!("skipping rotation pattern tests: no database ({e})");
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
            tenant: format!("test-rotations-{}", Uuid::new_v4()),
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
async fn a_pattern_is_previewed_written_planned_and_cleared() {
    let Some(app) = TestApp::spawn().await else { return };
    let early = app.create("/shifts", json!({ "name": "Early", "short_name": "E", "color": "#0EA5E9" })).await;
    let night = app.create("/shifts", json!({ "name": "Night", "short_name": "N", "color": "#6366F1" })).await;
    let email = |n: &str| format!("{n}-{}@test.invalid", Uuid::new_v4());
    // prepare refuses without a schedulable workstation.
    app.create("/workstations", json!({ "name": "Ward", "available": true, "active_shift_ids": [early, night] })).await;
    let anna = app.create("/employees", json!({ "name": "Anna", "email": email("anna"), "monthly_working_hours": 160 })).await;
    let ben = app.create("/employees", json!({ "name": "Ben", "email": email("ben"), "monthly_working_hours": 160 })).await;

    // Validation: an all-off cycle and an unknown shift are refused.
    let (status, _) = app
        .call(reqwest::Method::POST, "/rotation-patterns", Some(json!({ "name": "Idle", "slots": [null, null] })))
        .await;
    assert_eq!(status, 400);
    let (status, _) = app
        .call(reqwest::Method::POST, "/rotation-patterns", Some(json!({ "name": "Bad", "slots": [Uuid::new_v4()] })))
        .await;
    assert_eq!(status, 400);

    let pattern = app
        .create("/rotation-patterns", json!({ "name": "E-N-off", "slots": [early, night, null] }))
        .await;
    let (_, list) = app.call(reqwest::Method::GET, "/rotation-patterns", None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);

    let apply = |dry_run: bool| {
        json!({
            "employee_ids": [anna, ben],
            "start_date": "2026-10-05",
            "end_date": "2026-10-10",
            "offset_step": 1,
            "dry_run": dry_run,
        })
    };

    // Preview: nothing written, the grid staggered by a day for Ben.
    let (status, preview) = app
        .call(reqwest::Method::POST, &format!("/rotation-patterns/{pattern}/apply"), Some(apply(true)))
        .await;
    assert_eq!(status, 200, "body: {preview}");
    assert_eq!(preview["summary"]["written"], 12);
    assert_eq!(preview["rows"][0]["cells"][0]["shift_id"], json!(early));
    assert_eq!(preview["rows"][1]["cells"][0]["shift_id"], json!(night));
    assert_eq!(preview["rows"][1]["cells"][1]["shift_id"], Value::Null);
    let range = "/shift-assignments?from_date=2026-10-05&to_date=2026-10-10";
    let (_, fixed) = app.call(reqwest::Method::GET, range, None).await;
    assert_eq!(fixed.as_array().unwrap().len(), 0, "a dry run writes nothing");

    // Write, then write again: the second time everything is already there.
    let (_, written) = app
        .call(reqwest::Method::POST, &format!("/rotation-patterns/{pattern}/apply"), Some(apply(false)))
        .await;
    assert_eq!(written["summary"]["written"], 12);
    let (_, again) = app
        .call(reqwest::Method::POST, &format!("/rotation-patterns/{pattern}/apply"), Some(apply(false)))
        .await;
    assert_eq!((again["summary"]["written"].clone(), again["summary"]["unchanged"].clone()), (json!(0), json!(12)));
    let (_, fixed) = app.call(reqwest::Method::GET, range, None).await;
    let fixed = fixed.as_array().unwrap();
    assert_eq!(fixed.len(), 12);
    assert_eq!(fixed.iter().filter(|a| a["shift_id"].is_null()).count(), 4, "days off are fixed too");

    // The optimizer's input carries them.
    let (status, plan) = app
        .call(
            reqwest::Method::POST,
            "/planner/prepare",
            Some(json!({ "start_date": "2026-10-05", "end_date": "2026-10-11" })),
        )
        .await;
    assert_eq!(status, 200, "body: {plan}");
    let anna_task = plan["employees"].as_array().unwrap().iter().find(|e| e["id"] == json!(anna)).unwrap();
    let anna_fixed = anna_task["fixed_shifts"].as_array().unwrap();
    assert_eq!(anna_fixed.len(), 6);
    assert_eq!(anna_fixed[0], json!({ "date": "2026-10-05", "shift_id": early }));
    assert_eq!(anna_fixed[2], json!({ "date": "2026-10-07", "shift_id": null }));

    // Clear Anna only.
    let (_, cleared) = app
        .call(
            reqwest::Method::POST,
            "/shift-assignments/clear",
            Some(json!({ "employee_ids": [anna], "from_date": "2026-10-05", "to_date": "2026-10-10" })),
        )
        .await;
    assert_eq!(cleared["deleted"], 6);
    let (_, fixed) = app.call(reqwest::Method::GET, range, None).await;
    assert_eq!(fixed.as_array().unwrap().len(), 6);

    app.cleanup();
}
