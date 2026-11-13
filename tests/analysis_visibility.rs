//! `shift-viewer` and the roster's month status on the `/analysis/*` endpoints.
//!
//! A viewer sees the confirmed roster of published and locked months only (see
//! `/confirmed-shift-plans`). The analysis endpoints read the same table, so
//! they must leave a draft month out for a viewer too — otherwise the Fairness
//! page shows everyone's shifts, hours and wishes of a roster nobody has been
//! told about yet. Planners and admins see everything.
//!
//! Needs PostgreSQL; point `DATABASE_URL` at it, or leave it unset to use the
//! development default. With no database the tests print a notice and pass,
//! like the other integration tests.

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

const TENANT_TABLES: &[&str] = &[
    "shift_wishes",
    "roster_months",
    "confirmed_shift_plans",
    "shift_weekday_times",
    "shifts",
    "workstations",
    "employees",
];

/// October is a draft (no `roster_months` row), November is published.
const DRAFT_DAY: &str = "2026-10-05";
const PUBLISHED_DAY: &str = "2026-11-05";
const PERIOD: &str = "?from_date=2026-10-01&to_date=2026-11-30";

struct TestApp {
    base_url: String,
    keys: TestKeys,
    pool: DbPool,
    tenant: String,
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
                eprintln!("skipping analysis visibility tests: no database ({e})");
                return None;
            }
        };
        {
            // Test binaries run one after another, but the tests inside one start
            // together; migrating a fresh database from several threads collides.
            static MIGRATING: std::sync::Mutex<()> = std::sync::Mutex::new(());
            let _guard = MIGRATING.lock().unwrap_or_else(|e| e.into_inner());
            shift::database::run_migrations(&pool).expect("migrations");
        }

        let keys = TestKeys::serve().await;
        let mut state = AppState::new(Arc::new(pool.clone()));
        state.token_verifier = Some(keys.verifier());
        let app = shift::server::create_router(state);
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let app = Self {
            base_url: format!("http://{addr}/api/v1"),
            keys,
            pool,
            tenant: format!("test-visibility-{}", Uuid::new_v4()),
        };
        app.seed();
        Some(app)
    }

    fn sql(&self, statement: &str) {
        let mut conn = self.pool.get().expect("connection");
        diesel::sql_query(statement).execute(&mut conn).unwrap_or_else(|e| panic!("{statement}: {e}"));
    }

    /// One nurse on one workstation, rostered on a draft day and a published day,
    /// with a wish in each month.
    fn seed(&self) {
        let (tenant, employee, shift, ward) = (&self.tenant, Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        self.sql(&format!(
            "INSERT INTO employees (id, name, email, tenant_id) VALUES ('{employee}', 'Anna', 'anna@test.invalid', '{tenant}')"
        ));
        self.sql(&format!("INSERT INTO shifts (id, name, tenant_id) VALUES ('{shift}', 'Early', '{tenant}')"));
        for weekday in 0..7 {
            self.sql(&format!(
                "INSERT INTO shift_weekday_times (id, shift_id, weekday, start_time, end_time, min_employees, free_days_after_shift, tenant_id) \
                 VALUES ('{}', '{shift}', {weekday}, '06:00', '14:00', 1, 0, '{tenant}')",
                Uuid::new_v4()
            ));
        }
        self.sql(&format!(
            "INSERT INTO workstations (id, name, available, active_shift_ids, priority, min_employees, tenant_id) \
             VALUES ('{ward}', 'Ward', true, '{{}}', 'medium', 1, '{tenant}')"
        ));
        for day in [DRAFT_DAY, PUBLISHED_DAY] {
            self.sql(&format!(
                "INSERT INTO confirmed_shift_plans (employee_id, shift_id, workstation_id, date, is_present, tenant_id) \
                 VALUES ('{employee}', '{shift}', '{ward}', '{day}', true, '{tenant}')"
            ));
            self.sql(&format!(
                "INSERT INTO shift_wishes (id, employee_id, shift_id, wish_date, tenant_id) \
                 VALUES ('{}', '{employee}', '{shift}', '{day}', '{tenant}')",
                Uuid::new_v4()
            ));
        }
        self.sql(&format!(
            "INSERT INTO roster_months (tenant_id, month, status) VALUES ('{tenant}', '2026-11-01', 'published')"
        ));
    }

    async fn get(&self, role: &str, path: &str) -> Value {
        let token = self.keys.sign(json!({
            "sub": format!("{role}@test.invalid"),
            "tenant": [self.tenant],
            "realm_access": { "roles": [role] },
            "email": format!("{role}@test.invalid"),
            "preferred_username": format!("{role}@test.invalid"),
        }));
        let response = reqwest::Client::new()
            .get(format!("{}{}", self.base_url, path))
            .header("x-access-token", token)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        assert_eq!(status, 200, "GET {path} as {role}: {body}");
        body
    }
}

impl Drop for TestApp {
    fn drop(&mut self) {
        for table in TENANT_TABLES {
            self.sql(&format!("DELETE FROM {table} WHERE tenant_id = '{}'", self.tenant));
        }
    }
}

fn dates(body: &Value) -> Vec<String> {
    body.as_array()
        .expect("an array")
        .iter()
        .map(|row| row["date"].as_str().expect("a date").to_string())
        .collect()
}

#[tokio::test]
async fn a_viewer_sees_no_draft_day_in_the_staffing_and_workstation_figures() {
    let Some(app) = TestApp::spawn().await else { return };

    for path in [
        "/analysis/staffing-per-day",
        "/analysis/planned-hours-per-day-per-workstation",
        "/analysis/planned-employees-per-day-per-workstation",
    ] {
        let url = format!("{path}{PERIOD}");
        assert_eq!(dates(&app.get("shift-viewer", &url).await), [PUBLISHED_DAY], "{path}: viewer");
        for role in ["shift-planner", "shift-admin"] {
            assert_eq!(dates(&app.get(role, &url).await), [DRAFT_DAY, PUBLISHED_DAY], "{path}: {role}");
        }
    }
}

#[tokio::test]
async fn a_viewer_sees_no_shifts_hours_or_wishes_of_a_draft_month_on_the_fairness_page() {
    let Some(app) = TestApp::spawn().await else { return };
    let url = format!("/analysis/fairness{PERIOD}");

    let viewer = app.get("shift-viewer", &url).await;
    let anna = &viewer["employees"][0];
    assert_eq!(anna["shifts"], 1, "only the published day: {viewer}");
    assert_eq!(anna["wishes_asked"], 1, "the draft month's wish is not shown: {viewer}");
    assert_eq!(anna["wishes_granted"], 1);

    let planner = app.get("shift-planner", &url).await;
    let anna = &planner["employees"][0];
    assert_eq!(anna["shifts"], 2, "a planner sees both: {planner}");
    assert_eq!(anna["wishes_asked"], 2);
}

#[tokio::test]
async fn a_viewer_sees_a_locked_month_too() {
    let Some(app) = TestApp::spawn().await else { return };
    app.sql(&format!(
        "UPDATE roster_months SET status = 'locked' WHERE tenant_id = '{}'",
        app.tenant
    ));

    let body = app.get("shift-viewer", &format!("/analysis/staffing-per-day{PERIOD}")).await;
    assert_eq!(dates(&body), [PUBLISHED_DAY]);
}
