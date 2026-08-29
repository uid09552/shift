//! End-to-end tests for the shift-wish window (`/wish-settings`).
//!
//! These drive the real router over real HTTP against a real database, with
//! forged access tokens — the same path a request from the gateway takes, since
//! the backend only decodes the JWT payload (APISIX verifies the signature).
//! That is deliberate: the window's rules live partly in the role middleware and
//! partly in the handler, so only a request that goes through both proves them.
//!
//! Each test works in its own throwaway tenant and deletes its rows afterwards,
//! so it can run against a development database without touching real data.
//!
//! Needs PostgreSQL. Point `DATABASE_URL` at it, or leave it unset to use the
//! development default. When no database is reachable the tests print a notice
//! and pass rather than failing — CI does not run them today, and a missing
//! database should not look like a broken window.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::{json, Value};
use uuid::Uuid;

use shift::database::DbPool;
use shift::models::{NewEmployee, NewShift};
use shift::repository::AppState;
use shift::schema::{audit_logs, employees, shift_wishes, shifts, wish_settings};

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

/// A tenant with an employee and a shift, plus the base URL of a server serving
/// only that database. Dropping it leaves the rows behind — call `cleanup`.
struct TestApp {
    base_url: String,
    tenant: String,
    employee_id: Uuid,
    employee_email: String,
    shift_id: Uuid,
    pool: DbPool,
}

impl TestApp {
    /// Boots a server on an ephemeral port and seeds one employee and one shift
    /// in a fresh tenant. `None` when no database is reachable.
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
                eprintln!("skipping wish-window tests: no database ({e})");
                return None;
            }
        };
        shift::database::run_migrations(&pool).expect("migrations");

        let tenant = format!("test-wish-{}", Uuid::new_v4());
        let employee_email = format!("{}@test.invalid", Uuid::new_v4());

        let mut conn = pool.get().expect("connection");
        let employee_id: Uuid = diesel::insert_into(employees::table)
            .values(NewEmployee {
                name: "Wish Window Tester",
                email: &employee_email,
                monthly_working_hours: 160.0,
                tenant_id: &tenant,
            })
            .returning(employees::id)
            .get_result(&mut conn)
            .expect("insert employee");
        let shift_id: Uuid = diesel::insert_into(shifts::table)
            .values(NewShift {
                name: "Early",
                short_name: "E",
                color: "#22C55E",
                order: 1,
                tenant_id: &tenant,
            })
            .returning(shifts::id)
            .get_result(&mut conn)
            .expect("insert shift");
        drop(conn);

        // dev_mode stays false: the tests are about roles, and dev mode hands
        // every request planner *and* admin rights.
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
            tenant,
            employee_id,
            employee_email,
            shift_id,
            pool,
        })
    }

    /// A token as the gateway would forward it: `tenant` array claim, realm
    /// roles, and the identity a self-service write is matched against.
    fn token(&self, roles: &[&str], email: &str) -> String {
        let payload = json!({
            "tenant": [self.tenant],
            "realm_access": { "roles": roles },
            "email": email,
            "preferred_username": email,
        });
        let encode = |bytes: &[u8]| general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        format!(
            "{}.{}.signature",
            encode(br#"{"alg":"RS256","typ":"JWT"}"#),
            encode(payload.to_string().as_bytes()),
        )
    }

    /// The employee themselves — a `shift-viewer` writing their own wishes.
    fn viewer(&self) -> String {
        self.token(&["shift-viewer"], &self.employee_email)
    }

    fn planner(&self) -> String {
        self.token(&["shift-planner"], "planner@test.invalid")
    }

    fn admin(&self) -> String {
        self.token(&["shift-admin"], "admin@test.invalid")
    }

    async fn put_wish_settings(&self, token: &str, body: Value) -> (u16, Value) {
        self.send(reqwest::Client::new().put(format!("{}/wish-settings", self.base_url)).json(&body), token)
            .await
    }

    async fn get_wish_settings(&self, token: &str) -> (u16, Value) {
        self.send(reqwest::Client::new().get(format!("{}/wish-settings", self.base_url)), token)
            .await
    }

    async fn create_wish(&self, token: &str, date: &str) -> (u16, Value) {
        let body = json!({
            "employee_id": self.employee_id,
            "shift_id": self.shift_id,
            "wish_date": date,
        });
        self.send(reqwest::Client::new().post(format!("{}/shift-wishes", self.base_url)).json(&body), token)
            .await
    }

    async fn delete_wish(&self, token: &str, wish_id: &str) -> (u16, Value) {
        self.send(
            reqwest::Client::new().delete(format!("{}/shift-wishes/{wish_id}", self.base_url)),
            token,
        )
        .await
    }

    async fn send(&self, request: reqwest::RequestBuilder, token: &str) -> (u16, Value) {
        let response = request
            .header("x-access-token", token)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        (status, serde_json::from_str(&body).unwrap_or(Value::Null))
    }

    /// Every row this test created, in dependency order — the audit entries the
    /// settings writes leave behind included, so a test run leaves no trace.
    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(shift_wishes::table.filter(shift_wishes::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(employees::table.filter(employees::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(shifts::table.filter(shifts::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(wish_settings::table.filter(wish_settings::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(audit_logs::table.filter(audit_logs::tenant_id.eq(&self.tenant))).execute(&mut conn);
    }
}

/// Boots the app, or returns from the test when there is no database.
macro_rules! app {
    () => {
        match TestApp::spawn().await {
            Some(app) => app,
            None => return,
        }
    };
}

#[tokio::test]
async fn a_closed_window_refuses_an_employees_wish() {
    let app = app!();

    let (status, _) = app.put_wish_settings(&app.admin(), json!({ "mode": "disabled" })).await;
    assert_eq!(status, 200, "admin should be able to close the window");

    let (status, body) = app.create_wish(&app.viewer(), "2026-10-05").await;
    assert_eq!(status, 403, "a closed window must refuse the wish, got {body}");
    assert_eq!(body["error"], "Shift wishes are currently closed");

    let wishes = wishes_in_tenant(&app);
    assert_eq!(wishes, 0, "a refused wish must not be stored");

    app.cleanup();
}

#[tokio::test]
async fn a_date_range_window_refuses_wishes_outside_it() {
    let app = app!();

    let (status, _) = app
        .put_wish_settings(
            &app.admin(),
            json!({ "mode": "date_range", "window_start": "2026-10-01", "window_end": "2026-10-31" }),
        )
        .await;
    assert_eq!(status, 200);

    // Inside the window, both edges included.
    for date in ["2026-10-01", "2026-10-31"] {
        let (status, body) = app.create_wish(&app.viewer(), date).await;
        assert_eq!(status, 200, "{date} is inside the window, got {body}");
    }

    // Outside it, on either side.
    for date in ["2026-09-30", "2026-11-01"] {
        let (status, body) = app.create_wish(&app.viewer(), date).await;
        assert_eq!(status, 403, "{date} is outside the window, got {body}");
        assert_eq!(
            body["error"],
            "Shift wishes may only be placed for dates between 2026-10-01 and 2026-10-31"
        );
    }

    assert_eq!(wishes_in_tenant(&app), 2, "only the two allowed wishes should exist");

    app.cleanup();
}

#[tokio::test]
async fn an_employee_cannot_withdraw_a_wish_after_the_window_closed() {
    let app = app!();

    // Placed while wishing was open…
    let (status, _) = app.put_wish_settings(&app.admin(), json!({ "mode": "enabled" })).await;
    assert_eq!(status, 200);
    let (status, wish) = app.create_wish(&app.viewer(), "2026-10-05").await;
    assert_eq!(status, 200);
    let wish_id = wish["id"].as_str().expect("wish id").to_string();

    // …cannot be taken back once the window has closed behind it.
    app.put_wish_settings(&app.admin(), json!({ "mode": "disabled" })).await;
    let (status, body) = app.delete_wish(&app.viewer(), &wish_id).await;
    assert_eq!(status, 403, "a closed window must refuse the withdrawal, got {body}");
    assert_eq!(wishes_in_tenant(&app), 1, "the wish must survive the refused delete");

    // A planner is not bound by the window and can still clean it up.
    let (status, _) = app.delete_wish(&app.planner(), &wish_id).await;
    assert_eq!(status, 200);
    assert_eq!(wishes_in_tenant(&app), 0);

    app.cleanup();
}

#[tokio::test]
async fn planners_and_admins_are_not_bound_by_the_window() {
    let app = app!();

    app.put_wish_settings(&app.admin(), json!({ "mode": "disabled" })).await;

    for (role, token) in [("planner", app.planner()), ("admin", app.admin())] {
        let (status, body) = app.create_wish(&token, "2026-11-05").await;
        assert_eq!(status, 200, "a {role} may wish for anyone while the window is closed, got {body}");
        let wish_id = body["id"].as_str().expect("wish id").to_string();
        let (status, _) = app.delete_wish(&token, &wish_id).await;
        assert_eq!(status, 200, "a {role} may withdraw it again");
    }

    app.cleanup();
}

#[tokio::test]
async fn only_an_admin_may_change_the_window() {
    let app = app!();

    let (status, body) = app
        .put_wish_settings(&app.planner(), json!({ "mode": "disabled" }))
        .await;
    assert_eq!(status, 403, "a planner may not change the window, got {body}");
    assert_eq!(body["error"], "Only shift-admin may change the shift-wish window");

    let (status, _) = app.put_wish_settings(&app.viewer(), json!({ "mode": "disabled" })).await;
    assert_eq!(status, 403, "a viewer is stopped by the role middleware");

    // Everyone may read it — the calendar needs it to decide what to offer.
    for token in [app.viewer(), app.planner(), app.admin()] {
        let (status, body) = app.get_wish_settings(&token).await;
        assert_eq!(status, 200);
        assert_eq!(body["mode"], "enabled", "the planner's write must not have landed");
    }

    app.cleanup();
}

#[tokio::test]
async fn an_employee_may_not_wish_for_someone_else() {
    let app = app!();

    app.put_wish_settings(&app.admin(), json!({ "mode": "enabled" })).await;

    let stranger = app.token(&["shift-viewer"], "someone.else@test.invalid");
    let (status, body) = app.create_wish(&stranger, "2026-10-05").await;
    assert_eq!(status, 403, "an unrelated viewer must not wish for this employee, got {body}");
    assert_eq!(body["error"], "You may only manage your own shift wishes");
    assert_eq!(wishes_in_tenant(&app), 0);

    app.cleanup();
}

#[tokio::test]
async fn the_window_is_rejected_when_it_is_incomplete_or_inverted() {
    let app = app!();

    let cases = [
        json!({ "mode": "date_range" }),
        json!({ "mode": "date_range", "window_start": "2026-10-01" }),
        json!({ "mode": "date_range", "window_start": "2026-10-31", "window_end": "2026-10-01" }),
    ];
    for body in cases {
        let (status, response) = app.put_wish_settings(&app.admin(), body.clone()).await;
        assert_eq!(status, 400, "{body} should be rejected, got {response}");
    }

    // The stored window is unchanged by any of them.
    let (_, settings) = app.get_wish_settings(&app.admin()).await;
    assert_eq!(settings["mode"], "enabled");

    app.cleanup();
}

#[tokio::test]
async fn clearing_the_window_actually_clears_it() {
    let app = app!();

    app.put_wish_settings(
        &app.admin(),
        json!({ "mode": "date_range", "window_start": "2026-10-01", "window_end": "2026-10-31" }),
    )
    .await;

    let (status, body) = app
        .put_wish_settings(
            &app.admin(),
            json!({ "mode": "enabled", "window_start": null, "window_end": null }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["window_start"], Value::Null, "the dates must be cleared, not kept");
    assert_eq!(body["window_end"], Value::Null);

    let (_, reread) = app.get_wish_settings(&app.admin()).await;
    assert_eq!(reread["window_start"], Value::Null);

    app.cleanup();
}

fn wishes_in_tenant(app: &TestApp) -> i64 {
    let mut conn = app.pool.get().expect("connection");
    shift_wishes::table
        .filter(shift_wishes::tenant_id.eq(&app.tenant))
        .count()
        .get_result(&mut conn)
        .expect("count wishes")
}
