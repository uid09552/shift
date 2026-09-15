//! End-to-end tests for closing a workstation for a period.
//!
//! A closure is an inclusive date range during which the workstation is not
//! planned. The tenant-wide list lets views show every station's closures in
//! one call; overlapping closures on one station are refused, since removing
//! one of them would leave the station closed anyway.
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
use shift::schema::{
    audit_logs, confirmed_shift_plans, employees, optimized_shift_results, shifts,
    workstation_unavailabilities, workstations,
};

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
                eprintln!("skipping workstation closure tests: no database ({e})");
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
            tenant: format!("test-ws-closures-{}", Uuid::new_v4()),
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

    async fn request(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> (u16, Value) {
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

    async fn create_workstation(&self, name: &str) -> String {
        let (status, body) = self
            .request(
                reqwest::Method::POST,
                "/workstations",
                Some(json!({ "name": name, "available": true, "active_shift_ids": [] })),
            )
            .await;
        assert_eq!(status, 200, "body: {body}");
        body["id"].as_str().expect("workstation id").to_string()
    }

    async fn close(&self, workstation_id: &str, from: &str, to: &str) -> (u16, Value) {
        self.request(
            reqwest::Method::POST,
            &format!("/workstations/{workstation_id}/unavailabilities"),
            Some(json!({ "unavailable_from": from, "unavailable_to": to })),
        )
        .await
    }

    async fn create_id(&self, path: &str, body: Value) -> String {
        let (status, body) = self.request(reqwest::Method::POST, path, Some(body)).await;
        assert_eq!(status, 200, "POST {path}: {body}");
        body["id"].as_str().expect("id").to_string()
    }

    async fn roster(&self, employee: &str, shift: &str, workstation: &str, date: &str) -> (u16, Value) {
        self.request(
            reqwest::Method::POST,
            &format!("/employees/{employee}/confirmed-shift-plans"),
            Some(json!({ "shift_id": shift, "workstation_id": workstation, "date": date })),
        )
        .await
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(confirmed_shift_plans::table)
            .filter(confirmed_shift_plans::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(optimized_shift_results::table)
            .filter(optimized_shift_results::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(employees::table)
            .filter(employees::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(shifts::table)
            .filter(shifts::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(audit_logs::table)
            .filter(audit_logs::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(workstation_unavailabilities::table)
            .filter(workstation_unavailabilities::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(workstations::table)
            .filter(workstations::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
    }
}

fn periods(body: &Value) -> Vec<(String, String)> {
    let mut periods: Vec<(String, String)> = body
        .as_array()
        .expect("array")
        .iter()
        .map(|u| {
            (
                u["unavailable_from"].as_str().unwrap().to_string(),
                u["unavailable_to"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    periods.sort();
    periods
}

#[tokio::test]
async fn every_workstations_closures_come_back_in_one_list() {
    let Some(app) = TestApp::spawn().await else { return };
    let ward = app.create_workstation("Ward").await;
    let theatre = app.create_workstation("Theatre").await;

    assert_eq!(app.close(&ward, "2026-10-01", "2026-10-05").await.0, 200);
    assert_eq!(app.close(&theatre, "2026-10-20", "2026-10-31").await.0, 200);

    let (status, body) = app
        .request(reqwest::Method::GET, "/workstation-unavailabilities", None)
        .await;
    assert_eq!(status, 200, "body: {body}");
    assert_eq!(
        periods(&body),
        vec![
            ("2026-10-01".into(), "2026-10-05".into()),
            ("2026-10-20".into(), "2026-10-31".into()),
        ]
    );

    // A range keeps the periods that overlap it, even partly.
    let (_, body) = app
        .request(
            reqwest::Method::GET,
            "/workstation-unavailabilities?from_date=2026-10-05&to_date=2026-10-19",
            None,
        )
        .await;
    assert_eq!(periods(&body), vec![("2026-10-01".into(), "2026-10-05".into())]);

    // Either bound alone narrows the list too.
    let (_, body) = app
        .request(reqwest::Method::GET, "/workstation-unavailabilities?from_date=2026-10-06", None)
        .await;
    assert_eq!(periods(&body), vec![("2026-10-20".into(), "2026-10-31".into())]);

    app.cleanup();
}

#[tokio::test]
async fn an_overlapping_closure_is_refused() {
    let Some(app) = TestApp::spawn().await else { return };
    let ward = app.create_workstation("Ward").await;

    assert_eq!(app.close(&ward, "2026-10-01", "2026-10-10").await.0, 200);

    let (status, body) = app.close(&ward, "2026-10-10", "2026-10-12").await;
    assert_eq!(status, 400, "body: {body}");

    // The day after the closure ends is free to close.
    assert_eq!(app.close(&ward, "2026-10-11", "2026-10-12").await.0, 200);

    app.cleanup();
}

#[tokio::test]
async fn nobody_can_be_rostered_at_a_closed_or_deactivated_workstation() {
    let Some(app) = TestApp::spawn().await else { return };
    let ward = app.create_workstation("Ward").await;
    let clinic = app.create_workstation("Clinic").await;
    let shift = app
        .create_id("/shifts", json!({ "name": "Early", "short_name": "E", "color": "#0EA5E9" }))
        .await;
    let anna = app
        .create_id(
            "/employees",
            json!({ "name": "Anna", "email": format!("anna-{}@test.invalid", Uuid::new_v4()), "monthly_working_hours": 160 }),
        )
        .await;
    assert_eq!(app.close(&ward, "2026-10-01", "2026-10-05").await.0, 200);

    // Inside the closure: refused. The day after: fine.
    let (status, body) = app.roster(&anna, &shift, &ward, "2026-10-03").await;
    assert_eq!(status, 400, "body: {body}");
    let (status, planned) = app.roster(&anna, &shift, &ward, "2026-10-06").await;
    assert_eq!(status, 200, "body: {planned}");

    // Deactivated: refused on every day.
    let (status, _) = app
        .request(reqwest::Method::PATCH, &format!("/workstations/{clinic}/disable"), None)
        .await;
    assert_eq!(status, 200);
    let (status, body) = app.roster(&anna, &shift, &clinic, "2026-10-07").await;
    assert_eq!(status, 400, "body: {body}");

    // An entry already at a station that closes later stays editable, as long
    // as it is not moved onto a closed one.
    let plan_id = planned["id"].as_str().unwrap();
    assert_eq!(app.close(&ward, "2026-10-06", "2026-10-06").await.0, 200);
    let (status, body) = app
        .request(
            reqwest::Method::PUT,
            &format!("/confirmed-shift-plans/{plan_id}"),
            Some(json!({ "workstation_id": ward, "is_present": false, "absence_type": "sick" })),
        )
        .await;
    assert_eq!(status, 200, "body: {body}");
    let (status, _) = app
        .request(
            reqwest::Method::PUT,
            &format!("/confirmed-shift-plans/{plan_id}"),
            Some(json!({ "workstation_id": clinic })),
        )
        .await;
    assert_eq!(status, 400);

    app.cleanup();
}

#[tokio::test]
async fn a_proposal_staffing_a_closed_workstation_is_not_taken_as_the_plan() {
    let Some(app) = TestApp::spawn().await else { return };
    let ward = app.create_workstation("Ward").await;
    let shift = app
        .create_id("/shifts", json!({ "name": "Early", "short_name": "E", "color": "#0EA5E9" }))
        .await;
    let anna = app
        .create_id(
            "/employees",
            json!({ "name": "Anna", "email": format!("anna-{}@test.invalid", Uuid::new_v4()), "monthly_working_hours": 160 }),
        )
        .await;

    // Solved before the ward was closed: Anna works there on the 2nd.
    let result_id = Uuid::new_v4();
    let result = json!({
        "status": "optimal",
        "objective_value": 0.0,
        "planning_period": { "start_date": "2026-10-01", "end_date": "2026-10-02" },
        "schedule": [],
        "employee_plans": [{
            "employee_id": anna,
            "employee_name": "Anna",
            "daily_plan": [
                { "date": "2026-10-01", "status": "free" },
                { "date": "2026-10-02", "status": "assigned", "shift_id": shift, "shift_name": "Early",
                  "workstation_id": ward, "workstation_name": "Ward" },
            ],
        }],
        "message": null,
    });
    {
        let mut conn = app.pool.get().expect("connection");
        diesel::insert_into(optimized_shift_results::table)
            .values((
                optimized_shift_results::id.eq(result_id),
                optimized_shift_results::result.eq(&result),
                optimized_shift_results::creation_date.eq(chrono::Utc::now()),
                optimized_shift_results::tenant_id.eq(&app.tenant),
            ))
            .execute(&mut conn)
            .expect("insert optimized result");
    }
    assert_eq!(app.close(&ward, "2026-10-02", "2026-10-02").await.0, 200);

    let take = format!("/planner/optimized-shifts/{result_id}/take-as-plan");
    let (status, body) = app.request(reqwest::Method::POST, &take, Some(json!({}))).await;
    assert_eq!(status, 400, "body: {body}");
    assert!(body["error"].as_str().unwrap_or("").contains("Anna on 2026-10-02"), "body: {body}");

    // Nothing was written: the roster for the period is still empty.
    let (_, plans) = app
        .request(
            reqwest::Method::GET,
            "/confirmed-shift-plans?from_date=2026-10-01&to_date=2026-10-02",
            None,
        )
        .await;
    assert_eq!(plans["total"], 0, "body: {plans}");

    app.cleanup();
}
