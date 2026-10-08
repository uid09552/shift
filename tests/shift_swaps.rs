//! End-to-end tests for shift swaps (`/shift-swaps`): who may request, answer
//! and decide, what approval does to the confirmed roster, the stale check,
//! expiry, and that nothing is visible across tenants or to bystanders.
//!
//! Like the other suites these drive the real router over HTTP against a real
//! database, but with properly signed tokens (see `common`), since the backend
//! verifies them. Each test works in its own throwaway tenants and deletes what
//! it created. Needs PostgreSQL (`DATABASE_URL`, or the development default);
//! without one the tests print a notice and pass. No agent is configured, so
//! the planner's review reports why warnings are missing rather than warnings.

mod common;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Local, NaiveDate};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::{json, Value};
use uuid::Uuid;

use common::TestKeys;
use shift::database::DbPool;
use shift::models::{NewConfirmedShiftPlan, NewEmployee, NewShift, NewShiftSwapRequest};
use shift::repository::AppState;
use shift::schema::{
    audit_logs, capabilities, confirmed_shift_plans, employees, shift_swap_requests, shifts,
    workstation_required_capabilities, workstations,
};

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

struct Person {
    id: Uuid,
    email: String,
}

/// A tenant with three employees — Anna asks, Ben is asked, Carl looks on —
/// two shifts, and a server that trusts `keys`.
struct TestApp {
    base_url: String,
    tenant: String,
    other_tenant: String,
    keys: TestKeys,
    anna: Person,
    ben: Person,
    carl: Person,
    early: Uuid,
    late: Uuid,
    pool: DbPool,
}

fn day(offset: i64) -> NaiveDate {
    Local::now().date_naive() + chrono::Duration::days(offset)
}

impl TestApp {
    async fn spawn() -> Option<Self> {
        Self::spawn_with_agent(String::new()).await
    }

    /// With the backend asking `agent_url` for swap warnings.
    async fn spawn_with_agent(agent_url: String) -> Option<Self> {
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(ConnectionManager::<PgConnection>::new(url))
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping shift-swap tests: no database ({e})");
                return None;
            }
        };
        shift::database::run_migrations(&pool).expect("migrations");

        let tenant = format!("test-swap-{}", Uuid::new_v4());
        let mut conn = pool.get().expect("connection");
        let mut person = |name: &str| {
            let email = format!("{}-{}@test.invalid", name.to_lowercase(), Uuid::new_v4());
            let id = diesel::insert_into(employees::table)
                .values(NewEmployee { name, email: &email, monthly_working_hours: 160.0, tenant_id: &tenant })
                .returning(employees::id)
                .get_result(&mut conn)
                .expect("insert employee");
            Person { id, email }
        };
        let (anna, ben, carl) = (person("Anna"), person("Ben"), person("Carl"));
        let mut shift = |name: &str, order: i32| -> Uuid {
            diesel::insert_into(shifts::table)
                .values(NewShift { name, short_name: &name[..1], color: "#22C55E", order, tenant_id: &tenant })
                .returning(shifts::id)
                .get_result(&mut conn)
                .expect("insert shift")
        };
        let (early, late) = (shift("Early", 1), shift("Late", 2));
        drop(conn);

        let keys = TestKeys::serve().await;
        let mut state = AppState::new(Arc::new(pool.clone()));
        state.token_verifier = Some(keys.verifier());
        state.agent_url = agent_url;
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
            other_tenant: format!("{tenant}-other"),
            tenant,
            keys,
            anna,
            ben,
            carl,
            early,
            late,
            pool,
        })
    }

    fn token_in(&self, tenant: &str, roles: &[&str], email: &str) -> String {
        self.keys.sign(json!({
            "sub": email,
            "tenant": [tenant],
            "realm_access": { "roles": roles },
            "email": email,
            "preferred_username": email,
        }))
    }

    fn viewer(&self, who: &Person) -> String {
        self.token_in(&self.tenant, &["shift-viewer"], &who.email)
    }

    fn planner(&self) -> String {
        self.token_in(&self.tenant, &["shift-planner"], "planner@test.invalid")
    }

    async fn call(&self, method: reqwest::Method, path: &str, token: &str, body: Option<Value>) -> (u16, Value) {
        let mut request = reqwest::Client::new()
            .request(method, format!("{}{}", self.base_url, path))
            .header("x-access-token", token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn get(&self, path: &str, token: &str) -> (u16, Value) {
        self.call(reqwest::Method::GET, path, token, None).await
    }

    async fn post(&self, path: &str, token: &str, body: Option<Value>) -> (u16, Value) {
        self.call(reqwest::Method::POST, path, token, body).await
    }

    /// Anna offers her shift on `mine` for Ben's on `theirs`.
    async fn request(&self, token: &str, requester: Uuid, mine: NaiveDate, theirs: NaiveDate) -> (u16, Value) {
        let body = json!({
            "requester_id": requester,
            "requester_date": mine,
            "colleague_id": self.ben.id,
            "colleague_date": theirs,
        });
        self.post("/shift-swaps", token, Some(body)).await
    }

    /// A request Ben has accepted, now awaiting a planner.
    async fn accepted_request(&self, mine: NaiveDate, theirs: NaiveDate) -> String {
        let (status, swap) = self.request(&self.viewer(&self.anna), self.anna.id, mine, theirs).await;
        assert_eq!(status, 200, "{swap}");
        let id = swap["id"].as_str().unwrap().to_string();
        let (status, swap) = self.post(&format!("/shift-swaps/{id}/accept"), &self.viewer(&self.ben), None).await;
        assert_eq!(status, 200, "{swap}");
        id
    }

    fn roster(&self, employee: Uuid, date: NaiveDate, shift: Option<Uuid>) {
        let mut conn = self.pool.get().expect("connection");
        diesel::insert_into(confirmed_shift_plans::table)
            .values(NewConfirmedShiftPlan {
                employee_id: employee,
                shift_id: shift,
                workstation_id: None,
                date,
                is_present: shift.is_some(),
                absence_type: if shift.is_some() { None } else { Some("free".into()) },
                creation_type: "automated".into(),
                tenant_id: self.tenant.clone(),
            })
            .execute(&mut conn)
            .expect("insert roster row");
    }

    /// What `employee` has on `date`: `Some(shift)`, `Some(None)` for a row
    /// without a shift, `None` for no row.
    fn roster_cell(&self, employee: Uuid, date: NaiveDate) -> Option<Option<Uuid>> {
        let mut conn = self.pool.get().expect("connection");
        confirmed_shift_plans::table
            .filter(confirmed_shift_plans::tenant_id.eq(&self.tenant))
            .filter(confirmed_shift_plans::employee_id.eq(employee))
            .filter(confirmed_shift_plans::date.eq(date))
            .select(confirmed_shift_plans::shift_id)
            .first(&mut conn)
            .optional()
            .expect("read roster")
    }

    fn status_of(&self, id: &str) -> String {
        let mut conn = self.pool.get().expect("connection");
        shift_swap_requests::table
            .filter(shift_swap_requests::id.eq(Uuid::parse_str(id).unwrap()))
            .select(shift_swap_requests::status)
            .first(&mut conn)
            .expect("read status")
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        for tenant in [&self.tenant, &self.other_tenant] {
            let _ = diesel::delete(shift_swap_requests::table.filter(shift_swap_requests::tenant_id.eq(tenant))).execute(&mut conn);
            let _ = diesel::delete(confirmed_shift_plans::table.filter(confirmed_shift_plans::tenant_id.eq(tenant))).execute(&mut conn);
            let _ = diesel::delete(workstation_required_capabilities::table.filter(workstation_required_capabilities::tenant_id.eq(tenant))).execute(&mut conn);
            let _ = diesel::delete(workstations::table.filter(workstations::tenant_id.eq(tenant))).execute(&mut conn);
            let _ = diesel::delete(capabilities::table.filter(capabilities::tenant_id.eq(tenant))).execute(&mut conn);
            let _ = diesel::delete(employees::table.filter(employees::tenant_id.eq(tenant))).execute(&mut conn);
            let _ = diesel::delete(shifts::table.filter(shifts::tenant_id.eq(tenant))).execute(&mut conn);
            let _ = diesel::delete(audit_logs::table.filter(audit_logs::tenant_id.eq(tenant))).execute(&mut conn);
        }
    }
}

macro_rules! app {
    () => {
        match TestApp::spawn().await {
            Some(app) => app,
            None => return,
        }
    };
}

#[tokio::test]
async fn request_accept_approve_exchanges_shifts_on_different_days() {
    let app = app!();
    let (d1, d2) = (day(10), day(11));
    app.roster(app.anna.id, d1, Some(app.early));
    app.roster(app.anna.id, d2, None); // a free day, which goes to Ben
    app.roster(app.ben.id, d2, Some(app.late));

    let (status, swap) = app.request(&app.viewer(&app.anna), app.anna.id, d1, d2).await;
    assert_eq!(status, 200, "{swap}");
    assert_eq!(swap["status"], "pending_colleague");
    assert_eq!(swap["requester"]["shift_id"], json!(app.early));
    assert_eq!(swap["colleague"]["shift_id"], json!(app.late));
    let id = swap["id"].as_str().unwrap().to_string();

    // Not yet the planner's business.
    let (_, count) = app.get("/shift-swaps/pending-count", &app.planner()).await;
    assert_eq!(count["count"], 0);

    let (status, swap) = app.post(&format!("/shift-swaps/{id}/accept"), &app.viewer(&app.ben), None).await;
    assert_eq!(status, 200, "{swap}");
    assert_eq!(swap["status"], "pending_planner");

    let (status, count) = app.get("/shift-swaps/pending-count", &app.planner()).await;
    assert_eq!((status, count["count"].as_i64()), (200, Some(1)));

    // The planner's review: no agent here, so it says why there are no warnings.
    let (status, detail) = app.get(&format!("/shift-swaps/{id}"), &app.planner()).await;
    assert_eq!(status, 200, "{detail}");
    assert!(detail["warnings_error"].is_string(), "{detail}");

    let (status, swap) = app.post(&format!("/shift-swaps/{id}/approve"), &app.planner(), None).await;
    assert_eq!(status, 200, "{swap}");
    assert_eq!(swap["status"], "approved");
    assert_eq!(swap["decided_by"], "planner@test.invalid");

    assert_eq!(app.roster_cell(app.ben.id, d1), Some(Some(app.early)), "Ben takes Anna's early");
    assert_eq!(app.roster_cell(app.anna.id, d2), Some(Some(app.late)), "Anna takes Ben's late");
    assert_eq!(app.roster_cell(app.anna.id, d1), None, "Anna had nothing else on d1");
    assert_eq!(app.roster_cell(app.ben.id, d2), Some(None), "Ben gets Anna's free day on d2");

    let (_, logs) = app.get("/audit-logs?action=shift_swap.approve", &app.planner()).await;
    assert_eq!(logs["total"], 1, "{logs}");
    assert_eq!(logs["data"][0]["entity_id"], json!(id));

    app.cleanup();
}

#[tokio::test]
async fn a_same_day_swap_exchanges_the_two_shifts() {
    let app = app!();
    let d = day(5);
    app.roster(app.anna.id, d, Some(app.early));
    app.roster(app.ben.id, d, Some(app.late));

    let id = app.accepted_request(d, d).await;
    let (status, swap) = app.post(&format!("/shift-swaps/{id}/approve"), &app.planner(), None).await;
    assert_eq!(status, 200, "{swap}");

    assert_eq!(app.roster_cell(app.anna.id, d), Some(Some(app.late)));
    assert_eq!(app.roster_cell(app.ben.id, d), Some(Some(app.early)));

    app.cleanup();
}

#[tokio::test]
async fn only_the_right_person_may_take_each_step() {
    let app = app!();
    let d = day(3);
    app.roster(app.anna.id, d, Some(app.early));
    app.roster(app.ben.id, d, Some(app.late));

    // Planners decide; they do not request.
    let (status, body) = app.request(&app.planner(), app.anna.id, d, d).await;
    assert_eq!(status, 403, "{body}");
    // Nobody offers someone else's shift.
    let (status, body) = app.request(&app.viewer(&app.carl), app.anna.id, d, d).await;
    assert_eq!(status, 403, "{body}");

    let (status, swap) = app.request(&app.viewer(&app.anna), app.anna.id, d, d).await;
    assert_eq!(status, 200, "{swap}");
    let id = swap["id"].as_str().unwrap().to_string();

    // Only Ben answers.
    for who in [&app.anna, &app.carl] {
        let (status, body) = app.post(&format!("/shift-swaps/{id}/accept"), &app.viewer(who), None).await;
        assert_eq!(status, 403, "{body}");
    }
    // A planner cannot decide before Ben has agreed.
    let (status, body) = app.post(&format!("/shift-swaps/{id}/approve"), &app.planner(), None).await;
    assert_eq!(status, 409, "{body}");

    let (status, _) = app.post(&format!("/shift-swaps/{id}/accept"), &app.viewer(&app.ben), None).await;
    assert_eq!(status, 200);

    // Viewers never decide, not even the two involved.
    for who in [&app.anna, &app.ben] {
        for action in ["approve", "reject"] {
            let (status, body) = app.post(&format!("/shift-swaps/{id}/{action}"), &app.viewer(who), None).await;
            assert_eq!(status, 403, "{action}: {body}");
        }
    }
    // Only Anna cancels.
    let (status, _) = app.post(&format!("/shift-swaps/{id}/cancel"), &app.viewer(&app.ben), None).await;
    assert_eq!(status, 403);
    let (status, swap) = app.post(&format!("/shift-swaps/{id}/cancel"), &app.viewer(&app.anna), None).await;
    assert_eq!((status, swap["status"].as_str()), (200, Some("cancelled")));

    // A cancelled request is over.
    let (status, _) = app.post(&format!("/shift-swaps/{id}/approve"), &app.planner(), None).await;
    assert_eq!(status, 409);
    assert_eq!(app.roster_cell(app.anna.id, d), Some(Some(app.early)), "roster untouched");

    // The pending count is the planners' alone.
    let (status, _) = app.get("/shift-swaps/pending-count", &app.viewer(&app.anna)).await;
    assert_eq!(status, 403);

    app.cleanup();
}

#[tokio::test]
async fn a_decline_or_a_rejection_leaves_the_roster_alone() {
    let app = app!();
    let d = day(4);
    app.roster(app.anna.id, d, Some(app.early));
    app.roster(app.ben.id, d, Some(app.late));

    let (_, swap) = app.request(&app.viewer(&app.anna), app.anna.id, d, d).await;
    let id = swap["id"].as_str().unwrap();
    let (status, swap) = app.post(&format!("/shift-swaps/{id}/decline"), &app.viewer(&app.ben), None).await;
    assert_eq!((status, swap["status"].as_str()), (200, Some("rejected")));

    let id = app.accepted_request(d, d).await;
    let (status, swap) = app.post(&format!("/shift-swaps/{id}/reject"), &app.planner(), None).await;
    assert_eq!((status, swap["status"].as_str()), (200, Some("rejected")));

    assert_eq!(app.roster_cell(app.anna.id, d), Some(Some(app.early)));
    assert_eq!(app.roster_cell(app.ben.id, d), Some(Some(app.late)));

    app.cleanup();
}

#[tokio::test]
async fn approval_is_refused_when_the_roster_changed_meanwhile() {
    let app = app!();
    let d = day(6);
    app.roster(app.anna.id, d, Some(app.early));
    app.roster(app.ben.id, d, Some(app.late));
    let id = app.accepted_request(d, d).await;

    // The planner moves Anna to the late shift by hand in the meantime.
    {
        let mut conn = app.pool.get().unwrap();
        diesel::update(
            confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&app.tenant))
                .filter(confirmed_shift_plans::employee_id.eq(app.anna.id)),
        )
        .set(confirmed_shift_plans::shift_id.eq(Some(app.late)))
        .execute(&mut conn)
        .unwrap();
    }

    let (status, body) = app.post(&format!("/shift-swaps/{id}/approve"), &app.planner(), None).await;
    assert_eq!(status, 409, "{body}");
    assert!(body["error"].as_str().unwrap().contains("Anna"), "{body}");
    assert_eq!(app.status_of(&id), "stale");
    assert_eq!(app.roster_cell(app.ben.id, d), Some(Some(app.late)), "nothing exchanged");

    app.cleanup();
}

#[tokio::test]
async fn requests_need_real_future_shifts_and_free_days() {
    let app = app!();
    let (d1, d2) = (day(7), day(8));
    app.roster(app.anna.id, d1, Some(app.early));
    app.roster(app.ben.id, d2, Some(app.late));
    app.roster(app.ben.id, d1, Some(app.late)); // Ben already works on d1

    // Ben has no shift on d1 + 1 day.
    let (status, body) = app.request(&app.viewer(&app.anna), app.anna.id, d1, day(9)).await;
    assert_eq!(status, 400, "{body}");
    // Ben cannot take Anna's d1 shift on top of his own.
    let (status, body) = app.request(&app.viewer(&app.anna), app.anna.id, d1, d2).await;
    assert_eq!(status, 400, "{body}");
    assert!(body["error"].as_str().unwrap().contains("not free"), "{body}");
    // The past is not swapped.
    app.roster(app.anna.id, day(-1), Some(app.early));
    app.roster(app.ben.id, day(-1), Some(app.late));
    let (status, body) = app.request(&app.viewer(&app.anna), app.anna.id, day(-1), day(-1)).await;
    assert_eq!(status, 400, "{body}");

    app.cleanup();
}

#[tokio::test]
async fn an_unqualified_colleague_may_still_be_asked() {
    let app = app!();
    let d = day(2);
    let ward = {
        let mut conn = app.pool.get().unwrap();
        let skill: Uuid = diesel::insert_into(capabilities::table)
            .values((capabilities::name.eq("Intensive Care"), capabilities::tenant_id.eq(&app.tenant)))
            .returning(capabilities::id)
            .get_result(&mut conn)
            .unwrap();
        let ward: Uuid = diesel::insert_into(workstations::table)
            .values((
                workstations::name.eq("ICU"),
                workstations::active_shift_ids.eq(vec![app.early, app.late]),
                workstations::tenant_id.eq(&app.tenant),
            ))
            .returning(workstations::id)
            .get_result(&mut conn)
            .unwrap();
        diesel::insert_into(workstation_required_capabilities::table)
            .values((
                workstation_required_capabilities::workstation_id.eq(ward),
                workstation_required_capabilities::capability_id.eq(skill),
                workstation_required_capabilities::tenant_id.eq(&app.tenant),
            ))
            .execute(&mut conn)
            .unwrap();
        ward
    };
    app.roster(app.anna.id, d, Some(app.early));
    app.roster(app.ben.id, d, Some(app.late));
    {
        let mut conn = app.pool.get().unwrap();
        diesel::update(confirmed_shift_plans::table.filter(confirmed_shift_plans::employee_id.eq(app.anna.id)))
            .set(confirmed_shift_plans::workstation_id.eq(Some(ward)))
            .execute(&mut conn)
            .unwrap();
    }

    let (status, swap) = app.request(&app.viewer(&app.anna), app.anna.id, d, d).await;
    assert_eq!(status, 200, "Ben lacks Intensive Care, but that is the planner's call: {swap}");
    assert_eq!(swap["requester"]["workstation_id"], json!(ward));

    app.cleanup();
}

#[tokio::test]
async fn a_pending_request_expires_once_its_date_has_passed() {
    let app = app!();
    let id: Uuid = {
        let mut conn = app.pool.get().unwrap();
        diesel::insert_into(shift_swap_requests::table)
            .values(NewShiftSwapRequest {
                tenant_id: app.tenant.clone(),
                requester_id: app.anna.id,
                requester_date: day(-1),
                requester_shift_id: app.early,
                requester_workstation_id: None,
                colleague_id: app.ben.id,
                colleague_date: day(3),
                colleague_shift_id: app.late,
                colleague_workstation_id: None,
            })
            .returning(shift_swap_requests::id)
            .get_result(&mut conn)
            .unwrap()
    };

    let (status, swaps) = app.get("/shift-swaps", &app.viewer(&app.ben)).await;
    assert_eq!(status, 200, "{swaps}");
    assert_eq!(swaps[0]["status"], "expired");
    let (status, _) = app.post(&format!("/shift-swaps/{id}/accept"), &app.viewer(&app.ben), None).await;
    assert_eq!(status, 409, "an expired request cannot be accepted");

    app.cleanup();
}

#[tokio::test]
async fn requests_are_visible_only_to_those_involved_and_planners_of_the_tenant() {
    let app = app!();
    let d = day(9);
    app.roster(app.anna.id, d, Some(app.early));
    app.roster(app.ben.id, d, Some(app.late));
    let (_, swap) = app.request(&app.viewer(&app.anna), app.anna.id, d, d).await;
    let id = swap["id"].as_str().unwrap();

    for who in [&app.anna, &app.ben] {
        let (_, swaps) = app.get("/shift-swaps", &app.viewer(who)).await;
        assert_eq!(swaps.as_array().map(Vec::len), Some(1), "{swaps}");
    }
    let (_, swaps) = app.get("/shift-swaps", &app.viewer(&app.carl)).await;
    assert_eq!(swaps, json!([]), "Carl is not involved");
    let (status, _) = app.get(&format!("/shift-swaps/{id}"), &app.viewer(&app.carl)).await;
    assert_eq!(status, 404);

    let (_, swaps) = app.get("/shift-swaps", &app.planner()).await;
    assert_eq!(swaps.as_array().map(Vec::len), Some(1));

    // Another organization's planner sees nothing of it and cannot touch it.
    let outsider = app.token_in(&app.other_tenant, &["shift-planner"], "planner@other.invalid");
    let (_, swaps) = app.get("/shift-swaps", &outsider).await;
    assert_eq!(swaps, json!([]));
    let (status, _) = app.get(&format!("/shift-swaps/{id}"), &outsider).await;
    assert_eq!(status, 404);
    let (status, _) = app.post(&format!("/shift-swaps/{id}/reject"), &outsider, None).await;
    assert_eq!(status, 404);

    app.cleanup();
}

/// Stands in for the agent's `/roster/swap-check`: one warning for whoever the
/// requester is, but only if the caller's token came along.
async fn fake_agent() -> String {
    use axum::{http::HeaderMap, routing::post, Json, Router};
    let check = |headers: HeaderMap, Json(body): Json<Value>| async move {
        if headers.get("x-access-token").is_none() {
            return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({ "error": "no token" })));
        }
        let warning = json!({
            "employee_id": body["requester"]["employee_id"],
            "name": "Anna",
            "violations": ["only 8.0 h rest after the previous day's shift"],
        });
        (axum::http::StatusCode::OK, Json(json!({ "employees": [warning] })))
    };
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await.expect("bind agent");
    let addr = listener.local_addr().expect("agent addr");
    tokio::spawn(async move {
        let _ = axum::serve(listener, Router::new().route("/api/v1/roster/swap-check", post(check))).await;
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn the_planner_sees_the_agents_warnings_and_may_still_approve() {
    let Some(app) = TestApp::spawn_with_agent(fake_agent().await).await else { return };
    let d = day(12);
    app.roster(app.anna.id, d, Some(app.early));
    app.roster(app.ben.id, d, Some(app.late));
    let id = app.accepted_request(d, d).await;

    let (status, detail) = app.get(&format!("/shift-swaps/{id}"), &app.planner()).await;
    assert_eq!(status, 200, "{detail}");
    assert_eq!(detail["warnings"][0]["employee_id"], json!(app.anna.id), "{detail}");
    assert!(detail["warnings_error"].is_null());

    // The people involved see the request, not the planner's review.
    let (_, mine) = app.get(&format!("/shift-swaps/{id}"), &app.viewer(&app.anna)).await;
    assert!(mine["warnings"].is_null(), "{mine}");

    // A warning is not a refusal; the audit entry keeps what was shown.
    let (status, swap) = app.post(&format!("/shift-swaps/{id}/approve"), &app.planner(), None).await;
    assert_eq!(status, 200, "{swap}");
    let (_, logs) = app.get("/audit-logs?action=shift_swap.approve", &app.planner()).await;
    let changes: Value = serde_json::from_str(logs["data"][0]["changes"].as_str().unwrap()).unwrap();
    assert_eq!(changes["warnings"][0]["violations"][0], "only 8.0 h rest after the previous day's shift");

    app.cleanup();
}
