//! End-to-end tests for the Analytics page's fact endpoints.
//!
//! `GET /analysis/roster-facts`, `/analysis/change-facts`,
//! `/analysis/audit-activity` and `/analysis/planning-runs` are read-only,
//! bounded to a year, for planners and admins only, and never cross a tenant.
//!
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

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

/// Tables a test tenant writes to, children first.
const TENANT_TABLES: &[&str] = &[
    "roster_change_notices",
    "confirmed_shift_plans",
    "planning_tasks",
    "optimized_shift_results",
    "audit_logs",
    "shift_weekday_times",
    "shifts",
    "workstations",
    "employees",
];

struct TestApp {
    base_url: String,
    keys: TestKeys,
    pool: DbPool,
    tenants: Vec<String>,
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
                eprintln!("skipping analytics tests: no database ({e})");
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

        let tenants = (0..2).map(|_| format!("test-analytics-{}", Uuid::new_v4())).collect();
        Some(Self { base_url: format!("http://{addr}/api/v1"), keys, pool, tenants })
    }

    fn token(&self, tenant: &str, role: &str) -> String {
        self.keys.sign(json!({
            "sub": format!("{role}@test.invalid"),
            "tenant": [tenant],
            "realm_access": { "roles": [role] },
            "email": format!("{role}@test.invalid"),
            "preferred_username": format!("{role}@test.invalid"),
        }))
    }

    async fn get_as(&self, tenant: &str, role: &str, path: &str) -> (u16, Value) {
        let response = reqwest::Client::new()
            .get(format!("{}{}", self.base_url, path))
            .header("x-access-token", self.token(tenant, role))
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn get(&self, tenant: &str, path: &str) -> Value {
        let (status, body) = self.get_as(tenant, "shift-planner", path).await;
        assert_eq!(status, 200, "GET {path}: {body}");
        body
    }

    /// Test data goes in as SQL: these endpoints only read, and the roster
    /// guard in front of the write API is not what is under test here.
    fn sql(&self, statement: &str) {
        let mut conn = self.pool.get().expect("connection");
        diesel::sql_query(statement).execute(&mut conn).unwrap_or_else(|e| panic!("{statement}: {e}"));
    }

    /// An employee, returning its id.
    fn employee(&self, tenant: &str, name: &str) -> Uuid {
        let id = Uuid::new_v4();
        self.sql(&format!(
            "INSERT INTO employees (id, name, email, tenant_id) VALUES ('{id}', '{name}', '{name}@test.invalid', '{tenant}')"
        ));
        id
    }

    /// A shift with the same time every weekday and `saturday_min` on Saturdays.
    fn shift(&self, tenant: &str, name: &str, start: &str, end: &str, saturday_min: i16) -> Uuid {
        let id = Uuid::new_v4();
        self.sql(&format!("INSERT INTO shifts (id, name, tenant_id) VALUES ('{id}', '{name}', '{tenant}')"));
        for weekday in 0..7 {
            let min = if weekday == 5 { saturday_min } else { 1 };
            self.sql(&format!(
                "INSERT INTO shift_weekday_times (id, shift_id, weekday, start_time, end_time, min_employees, free_days_after_shift, tenant_id) \
                 VALUES ('{}', '{id}', {weekday}, '{start}', '{end}', {min}, 0, '{tenant}')",
                Uuid::new_v4()
            ));
        }
        id
    }

    fn roster(&self, tenant: &str, employee: Uuid, shift: Option<Uuid>, date: &str, absence: Option<&str>) {
        let shift = shift.map(|s| format!("'{s}'")).unwrap_or("NULL".into());
        let (present, absence) = match absence {
            Some(a) => ("false", format!("'{a}'")),
            None => ("true", "NULL".into()),
        };
        self.sql(&format!(
            "INSERT INTO confirmed_shift_plans (employee_id, shift_id, date, is_present, absence_type, tenant_id) \
             VALUES ('{employee}', {shift}, '{date}', {present}, {absence}, '{tenant}')"
        ));
    }

    /// A change notice moving `employee` onto `workstation_after` on `date`.
    fn notice(&self, tenant: &str, employee: Uuid, date: &str, source: &str, reason: Option<&str>, workstation_after: Option<Uuid>, acknowledged: bool) {
        let reason = reason.map(|r| format!("'{r}'")).unwrap_or("NULL".into());
        let after = workstation_after
            .map(|w| format!("'{{\"shift_id\":null,\"workstation_id\":\"{w}\",\"absence_type\":null}}'"))
            .unwrap_or("NULL".into());
        let ack = if acknowledged { "now()" } else { "NULL" };
        self.sql(&format!(
            "INSERT INTO roster_change_notices (tenant_id, employee_id, date, before, after, source, actor, reason, acknowledged_at) \
             VALUES ('{tenant}', '{employee}', '{date}', NULL, {after}, '{source}', 'planner@test.invalid', {reason}, {ack})"
        ));
    }

    fn audit(&self, tenant: &str, actor: &str, action: &str, entity_type: &str, entity_id: &str, changes: Option<&str>) {
        let changes = changes.map(|c| format!("'{c}'")).unwrap_or("NULL".into());
        self.sql(&format!(
            "INSERT INTO audit_logs (id, tenant_id, actor, action, entity_type, entity_id, changes, created_at) \
             VALUES ('{}', '{tenant}', '{actor}', '{action}', '{entity_type}', '{entity_id}', {changes}, now())",
            Uuid::new_v4()
        ));
    }

    /// A planning task, with a solver result when `solver` is given; returns its id.
    fn run(&self, tenant: &str, source: &str, status: &str, solver: Option<(&str, &str)>, error: Option<&str>) -> Uuid {
        let task = Uuid::new_v4();
        let result = match solver {
            Some((solver_status, message)) => {
                let id = Uuid::new_v4();
                self.sql(&format!(
                    "INSERT INTO optimized_shift_results (id, result, tenant_id) VALUES ('{id}', \
                     '{{\"status\":\"{solver_status}\",\"message\":\"{message}\",\"planning_period\":{{\"start_date\":\"2026-10-01\",\"end_date\":\"2026-10-31\"}},\"employee_plans\":[{{\"employee_id\":\"secret-plan\"}}]}}', '{tenant}')"
                ));
                format!("'{id}'")
            }
            None => "NULL".into(),
        };
        let error = error.map(|e| format!("'{e}'")).unwrap_or("NULL".into());
        self.sql(&format!(
            "INSERT INTO planning_tasks (id, status, payload, result_id, error_message, tenant_id, source) \
             VALUES ('{task}', '{status}', '{{}}', {result}, {error}, '{tenant}', '{source}')"
        ));
        task
    }

    fn workstation(&self, tenant: &str, name: &str) -> Uuid {
        let id = Uuid::new_v4();
        self.sql(&format!(
            "INSERT INTO workstations (id, name, available, active_shift_ids, priority, min_employees, tenant_id) \
             VALUES ('{id}', '{name}', true, '{{}}', 'medium', 1, '{tenant}')"
        ));
        id
    }

    fn cleanup(&self) {
        for tenant in &self.tenants {
            for table in TENANT_TABLES {
                self.sql(&format!("DELETE FROM {table} WHERE tenant_id = '{tenant}'"));
            }
        }
    }
}

const ENDPOINTS: &[&str] = &[
    "/analysis/roster-facts",
    "/analysis/change-facts",
    "/analysis/audit-activity",
    "/analysis/planning-runs",
];

#[tokio::test]
async fn facts_are_for_planners_bounded_to_a_year_and_never_cross_a_tenant() {
    let Some(app) = TestApp::spawn().await else { return };
    let (a, b) = (app.tenants[0].clone(), app.tenants[1].clone());
    let period = "?from_date=2026-09-01&to_date=2026-09-30";

    for endpoint in ENDPOINTS {
        let (status, _) = app.get_as(&a, "shift-viewer", &format!("{endpoint}{period}")).await;
        assert_eq!(status, 403, "{endpoint} refuses a viewer");
        let (status, body) = app
            .get_as(&a, "shift-planner", &format!("{endpoint}?from_date=2025-09-01&to_date=2026-09-30"))
            .await;
        assert_eq!(status, 400, "{endpoint} refuses more than a year: {body}");
        assert!(body.to_string().contains("one year"), "{body}");
        let (status, _) = app.get_as(&a, "shift-admin", &format!("{endpoint}{period}")).await;
        assert_eq!(status, 200, "{endpoint} answers an admin");
    }

    // Same dates in both tenants; each sees only its own.
    for tenant in [&a, &b] {
        let anna = app.employee(tenant, "Anna");
        let early = app.shift(tenant, "Early", "06:00", "14:00", 2);
        app.roster(tenant, anna, Some(early), "2026-09-12", None);
    }
    let anna_b = app.employee(&b, "Ben");
    app.roster(&b, anna_b, None, "2026-09-12", Some("sick"));

    let facts_a = app.get(&a, &format!("/analysis/roster-facts{period}")).await;
    let facts_b = app.get(&b, &format!("/analysis/roster-facts{period}")).await;
    assert_eq!(facts_a["rows"]["date"].as_array().unwrap().len(), 1, "{facts_a}");
    assert_eq!(facts_b["rows"]["date"].as_array().unwrap().len(), 2, "{facts_b}");
    assert_eq!(facts_a["dims"]["employees"].as_array().unwrap().len(), 1);

    // The Saturday rule and the row's counting come through.
    let saturday = facts_a["dims"]["shifts"][0]["weekday"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["weekday"] == 5)
        .cloned()
        .unwrap();
    assert_eq!(saturday["min"], 2);
    assert_eq!(facts_a["rows"]["hours"][0], 8.0);
    assert_eq!(facts_a["rows"]["weekend"][0], "2026-09-12");
    // No e-mail anywhere in the answer.
    assert!(!facts_a.to_string().contains("@test.invalid"), "{facts_a}");

    app.cleanup();
}

#[tokio::test]
async fn change_facts_carry_source_reason_workstations_and_acknowledgement() {
    let Some(app) = TestApp::spawn().await else { return };
    let (a, b) = (app.tenants[0].clone(), app.tenants[1].clone());
    let today = chrono::Utc::now().date_naive();
    let period = format!("?from_date={today}&to_date={today}");

    let anna = app.employee(&a, "Anna");
    let icu = app.workstation(&a, "ICU");
    app.notice(&a, anna, "2026-09-14", "replacement", Some("Krankmeldung Ben"), Some(icu), false);
    app.notice(&a, anna, "2026-09-15", "manual", None, None, true);
    let other = app.employee(&b, "Carla");
    app.notice(&b, other, "2026-09-14", "manual", None, None, false);

    let facts = app.get(&a, &format!("/analysis/change-facts{period}")).await;
    let notices = facts["notices"].as_array().expect("notices");
    assert_eq!(notices.len(), 2, "only tenant A's: {facts}");

    let replacement = notices.iter().find(|n| n["source"] == "replacement").expect("replacement");
    assert_eq!(replacement["employee_name"], "Anna");
    assert_eq!(replacement["workstation_after_name"], "ICU");
    assert_eq!(replacement["reason"], "Krankmeldung Ben");
    assert!(replacement["acknowledged_at"].is_null(), "unacknowledged");
    let manual = notices.iter().find(|n| n["source"] == "manual").expect("manual");
    assert!(!manual["acknowledged_at"].is_null());

    // Created today, so a period that ends yesterday finds none.
    let yesterday = today - chrono::Duration::days(1);
    let none = app.get(&a, &format!("/analysis/change-facts?from_date={yesterday}&to_date={yesterday}")).await;
    assert_eq!(none["notices"].as_array().unwrap().len(), 0);

    app.cleanup();
}

#[tokio::test]
async fn audit_activity_counts_match_the_audit_log() {
    let Some(app) = TestApp::spawn().await else { return };
    let (a, b) = (app.tenants[0].clone(), app.tenants[1].clone());
    let today = chrono::Utc::now().date_naive();
    let period = format!("?from_date={today}&to_date={today}");

    for _ in 0..3 {
        app.audit(&a, "anna@clinic.test", "workstation.create", "workstation", "w1", None);
    }
    app.audit(&a, "ben@clinic.test", "workstation.delete", "workstation", "w1", Some(r#"{"name":"ICU"}"#));
    app.audit(&a, "auto-planner", "planner.auto_run", "planning_task", "t1", None);
    app.audit(&b, "anna@clinic.test", "workstation.create", "workstation", "w9", None);

    let activity = app.get(&a, &format!("/analysis/audit-activity{period}")).await;
    let groups = activity["groups"].as_array().expect("groups");
    let sum: i64 = groups.iter().map(|g| g["count"].as_i64().unwrap()).sum();
    assert_eq!(activity["total"], 5, "tenant A only: {activity}");
    assert_eq!(sum, 5, "groups add up to the total");

    // One group equals the audit log filtered the way the page drills into it.
    let creates = groups.iter().find(|g| g["action"] == "workstation.create").expect("create group");
    assert_eq!(creates["count"], 3);
    assert_eq!(creates["day"], today.to_string());
    let listed = app
        .get(&a, &format!("/audit-logs?action=workstation.create&entity_type=workstation&actor=anna%40clinic.test&from_date={today}&to_date={today}"))
        .await;
    assert_eq!(listed["total"], creates["count"]);

    assert!(groups.iter().any(|g| g["actor"] == "auto-planner" && g["count"] == 1), "{activity}");

    app.cleanup();
}

#[tokio::test]
async fn planning_runs_report_solver_outcome_and_whether_an_automatic_plan_was_taken() {
    let Some(app) = TestApp::spawn().await else { return };
    let a = app.tenants[0].clone();
    let today = chrono::Utc::now().date_naive();
    let period = format!("?from_date={today}&to_date={today}");

    let kept = app.run(&a, "auto", "done", Some(("feasible", "2 slots short")), None);
    app.audit(&a, "auto-planner", "planner.auto_result", "planning_task", &kept.to_string(),
        Some(&format!(r#"{{"outcome":"kept_as_proposal","note":"short","task_id":"{kept}"}}"#)));
    let taken = app.run(&a, "auto", "done", Some(("optimal", "")), None);
    app.audit(&a, "auto-planner", "planner.auto_result", "planning_task", &taken.to_string(),
        Some(&format!(r#"{{"outcome":"taken_over","note":null,"task_id":"{taken}"}}"#)));
    let failed = app.run(&a, "manual", "error", None, Some("optimizer unreachable"));

    let body = app.get(&a, &format!("/analysis/planning-runs{period}")).await;
    let runs = body["runs"].as_array().expect("runs");
    assert_eq!(runs.len(), 3, "{body}");
    let by_id = |id: Uuid| runs.iter().find(|r| r["id"] == id.to_string()).cloned().expect("run");

    let k = by_id(kept);
    assert_eq!((k["source"].as_str(), k["solver_status"].as_str()), (Some("auto"), Some("feasible")));
    assert_eq!((k["has_message"].as_bool(), k["taken_as_roster"].as_bool()), (Some(true), Some(false)));
    assert_eq!(k["period_start"], "2026-10-01");
    assert!(!k["finished_at"].is_null());

    let t = by_id(taken);
    assert_eq!((t["has_message"].as_bool(), t["taken_as_roster"].as_bool()), (Some(false), Some(true)));

    let f = by_id(failed);
    assert_eq!(f["status"], "error");
    assert_eq!(f["error_message"], "optimizer unreachable");
    assert!(f["solver_status"].is_null() && f["taken_as_roster"].is_null(), "{f}");

    assert!(!body.to_string().contains("secret-plan"), "the plan itself is never returned");

    app.cleanup();
}
