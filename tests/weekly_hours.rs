//! End-to-end tests for weekly working hours: an employee's own value or the
//! tenant default (`planner_settings.default_weekly_working_hours`, 40 unless
//! changed), what the API returns and accepts, what the optimizer input gets,
//! and the migration's conversion from monthly hours.
//!
//! Real router, real database, signed tokens (see `common`). Each test works in
//! its own throwaway tenant and deletes what it created. Needs PostgreSQL
//! (`DATABASE_URL`, or the development default); without one the tests print a
//! notice and pass.

mod common;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::{json, Value};
use uuid::Uuid;

use common::TestKeys;
use shift::database::DbPool;
use shift::repository::AppState;
use shift::schema::{audit_logs, employees, planner_settings, shifts, workstations};

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
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(ConnectionManager::<PgConnection>::new(url))
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping weekly-hours tests: no database ({e})");
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
            tenant: format!("test-weekly-{}", Uuid::new_v4()),
            keys,
            pool,
        })
    }

    fn token(&self, role: &str) -> String {
        self.keys.sign(json!({
            "tenant": [self.tenant],
            "realm_access": { "roles": [role] },
            "email": format!("{role}@test.invalid"),
        }))
    }

    async fn call_as(&self, role: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> (u16, Value) {
        let mut request = reqwest::Client::new()
            .request(method, format!("{}{}", self.base_url, path))
            .header("x-access-token", self.token(role));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn call(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> (u16, Value) {
        self.call_as("shift-planner", method, path, body).await
    }

    async fn create_employee(&self, name: &str, extra: Value) -> Value {
        let mut body = json!({ "name": name, "email": format!("{}-{}@test.invalid", name.to_lowercase(), Uuid::new_v4()) });
        body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        let (status, employee) = self.call(reqwest::Method::POST, "/employees", Some(body)).await;
        assert_eq!(status, 200, "{employee}");
        employee
    }

    /// Everyone, keyed by name.
    async fn employees(&self) -> std::collections::HashMap<String, Value> {
        let (status, page) = self.call(reqwest::Method::GET, "/employees?limit=100", None).await;
        assert_eq!(status, 200, "{page}");
        page["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| (e["name"].as_str().unwrap().to_string(), e.clone()))
            .collect()
    }

    /// The current settings with `default_weekly_working_hours` changed, as `role`.
    async fn set_default(&self, role: &str, hours: f64) -> (u16, Value) {
        let (_, mut settings) = self.call(reqwest::Method::GET, "/planner-settings", None).await;
        settings["default_weekly_working_hours"] = json!(hours);
        self.call_as(role, reqwest::Method::PUT, "/planner-settings", Some(settings)).await
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(employees::table.filter(employees::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(workstations::table.filter(workstations::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(shifts::table.filter(shifts::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(planner_settings::table.filter(planner_settings::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(audit_logs::table.filter(audit_logs::tenant_id.eq(&self.tenant))).execute(&mut conn);
    }
}

#[tokio::test]
async fn an_employee_without_hours_follows_the_default_and_an_own_value_wins() {
    let Some(app) = TestApp::spawn().await else { return };

    let anna = app.create_employee("Anna", json!({})).await;
    assert_eq!(anna["weekly_working_hours"], Value::Null);
    assert_eq!(anna["effective_weekly_working_hours"], 40.0, "the shipped default");

    let ben = app.create_employee("Ben", json!({ "weekly_working_hours": 30 })).await;
    assert_eq!((ben["weekly_working_hours"].as_f64(), ben["effective_weekly_working_hours"].as_f64()), (Some(30.0), Some(30.0)));

    let carla = app.create_employee("Carla", json!({ "weekly_working_hours": 0 })).await;
    assert_eq!(carla["effective_weekly_working_hours"], 0.0, "0 is no target, not the default");

    app.cleanup();
}

#[tokio::test]
async fn changing_the_default_moves_only_those_who_follow_it() {
    let Some(app) = TestApp::spawn().await else { return };
    app.create_employee("Anna", json!({})).await;
    app.create_employee("Ben", json!({ "weekly_working_hours": 30 })).await;

    let (status, settings) = app.set_default("shift-planner", 38.5).await;
    assert_eq!(status, 200, "{settings}");
    assert_eq!(settings["default_weekly_working_hours"], 38.5);

    let people = app.employees().await;
    assert_eq!(people["Anna"]["effective_weekly_working_hours"], 38.5);
    assert_eq!(people["Ben"]["effective_weekly_working_hours"], 30.0);

    app.cleanup();
}

#[tokio::test]
async fn only_planners_and_admins_change_the_default_and_it_stays_sensible() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, _) = app.set_default("shift-viewer", 20.0).await;
    assert_eq!(status, 403, "a viewer may read the default, not change it");
    let (status, settings) = app.call_as("shift-viewer", reqwest::Method::GET, "/planner-settings", None).await;
    assert_eq!((status, settings["default_weekly_working_hours"].as_f64()), (200, Some(40.0)));

    for hours in [0.0, -1.0, 169.0] {
        let (status, body) = app.set_default("shift-admin", hours).await;
        assert_eq!(status, 400, "{hours}: {body}");
    }
    let (status, _) = app.set_default("shift-admin", 35.0).await;
    assert_eq!(status, 200);

    app.cleanup();
}

#[tokio::test]
async fn updates_keep_clear_or_set_the_own_value() {
    let Some(app) = TestApp::spawn().await else { return };
    let anna = app.create_employee("Anna", json!({ "weekly_working_hours": 30 })).await;
    let path = format!("/employees/{}", anna["id"].as_str().unwrap());

    // Absent: unchanged.
    let (status, same) = app.call(reqwest::Method::PUT, &path, Some(json!({ "name": "Anna B." }))).await;
    assert_eq!((status, same["weekly_working_hours"].as_f64()), (200, Some(30.0)), "{same}");

    // null: back to the default.
    let (status, reset) = app.call(reqwest::Method::PUT, &path, Some(json!({ "weekly_working_hours": null }))).await;
    assert_eq!(status, 200, "{reset}");
    assert_eq!(reset["weekly_working_hours"], Value::Null);
    assert_eq!(reset["effective_weekly_working_hours"], 40.0);

    // Out of range.
    let (status, body) = app.call(reqwest::Method::PUT, &path, Some(json!({ "weekly_working_hours": 200 }))).await;
    assert_eq!(status, 400, "{body}");

    app.cleanup();
}

#[tokio::test]
async fn monthly_hours_are_refused_with_the_new_field_named() {
    let Some(app) = TestApp::spawn().await else { return };

    let body = json!({ "name": "Anna", "email": "anna@test.invalid", "monthly_working_hours": 160 });
    let (status, error) = app.call(reqwest::Method::POST, "/employees", Some(body)).await;
    assert_eq!(status, 400, "{error}");
    assert!(error["error"].as_str().unwrap().contains("weekly_working_hours"), "{error}");

    let anna = app.create_employee("Ben", json!({})).await;
    let path = format!("/employees/{}", anna["id"].as_str().unwrap());
    let (status, _) = app.call(reqwest::Method::PUT, &path, Some(json!({ "monthly_working_hours": 160 }))).await;
    assert_eq!(status, 400);

    app.cleanup();
}

#[tokio::test]
async fn the_optimizer_input_carries_the_effective_weekly_hours() {
    let Some(app) = TestApp::spawn().await else { return };
    let (_, shift) = app.call(reqwest::Method::POST, "/shifts", Some(json!({ "name": "Early", "short_name": "E", "color": "#22C55E" }))).await;
    let shift_id = shift["id"].as_str().unwrap();
    let (status, ws) = app
        .call(reqwest::Method::POST, "/workstations", Some(json!({ "name": "Ward", "available": true, "active_shift_ids": [shift_id] })))
        .await;
    assert_eq!(status, 200, "{ws}");
    app.create_employee("Anna", json!({})).await;
    app.create_employee("Ben", json!({ "weekly_working_hours": 30 })).await;
    app.set_default("shift-planner", 38.5).await;

    let (status, task) = app
        .call(reqwest::Method::POST, "/planner/prepare", Some(json!({ "start_date": "2026-11-02", "end_date": "2026-11-15" })))
        .await;
    assert_eq!(status, 200, "{task}");
    let hours: std::collections::HashMap<&str, f64> = task["employees"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["name"].as_str().unwrap(), e["weekly_working_hours"].as_f64().unwrap()))
        .collect();
    assert_eq!(hours["Anna"], 38.5, "the default, resolved before the planner sees it");
    assert_eq!(hours["Ben"], 30.0);
    assert!(task["employees"][0].get("monthly_working_hours").is_none());

    app.cleanup();
}

#[tokio::test]
async fn the_migration_converts_monthly_hours_and_leaves_zero_to_the_default() {
    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
    let Ok(mut conn) = PgConnection::establish(&url) else {
        eprintln!("skipping migration test: no database");
        return;
    };
    // The migration's own SQL, run against stand-in tables in a scratch schema.
    let up = include_str!("../migrations/00000000000033_weekly_working_hours/up.sql");
    let down = include_str!("../migrations/00000000000033_weekly_working_hours/down.sql");
    let schema = format!("mtest_{}", Uuid::new_v4().simple());
    let run = |conn: &mut PgConnection| -> QueryResult<Vec<(i32, Option<f64>, Option<f64>)>> {
        conn.batch_execute(&format!(
            "CREATE SCHEMA {schema}; SET search_path TO {schema};
             CREATE TABLE employees (id INT, monthly_working_hours DOUBLE PRECISION NOT NULL DEFAULT 0);
             CREATE TABLE planner_settings (tenant_id TEXT);
             INSERT INTO employees VALUES (1, 160), (2, 0), (3, 80);"
        ))?;
        conn.batch_execute(up)?;
        #[derive(QueryableByName)]
        struct Row {
            #[diesel(sql_type = diesel::sql_types::Integer)]
            id: i32,
            #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::Double>)]
            weekly: Option<f64>,
        }
        let after: Vec<Row> = diesel::sql_query("SELECT id, weekly_working_hours AS weekly FROM employees ORDER BY id").load(conn)?;
        conn.batch_execute(down)?;
        #[derive(QueryableByName)]
        struct Back {
            #[diesel(sql_type = diesel::sql_types::Double)]
            monthly: f64,
        }
        let back: Vec<Back> = diesel::sql_query("SELECT monthly_working_hours AS monthly FROM employees ORDER BY id").load(conn)?;
        Ok(after.into_iter().zip(back).map(|(a, b)| (a.id, a.weekly, Some(b.monthly))).collect())
    };
    let result = run(&mut conn);
    let _ = conn.batch_execute(&format!("SET search_path TO public; DROP SCHEMA IF EXISTS {schema} CASCADE;"));
    let rows = result.expect("migration SQL");

    assert_eq!(rows[0], (1, Some(37.0), Some(160.3)), "160 a month → 37 a week, and back");
    assert_eq!(rows[1], (2, None, Some(0.0)), "never set → follows the default; back to 0");
    assert_eq!(rows[2], (3, Some(18.5), Some(80.2)));
}

impl TestApp {
    /// POSTs an .xlsx as the `file` field of a multipart upload.
    async fn upload(&self, path: &str, xlsx: Vec<u8>) -> (u16, Value) {
        let boundary = format!("----test{}", Uuid::new_v4().simple());
        let mut body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"employees.xlsx\"\r\n\
             Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
        )
        .into_bytes();
        body.extend(xlsx);
        body.extend(format!("\r\n--{boundary}--\r\n").into_bytes());
        let response = reqwest::Client::new()
            .post(format!("{}{}", self.base_url, path))
            .header("x-access-token", self.token("shift-planner"))
            .header("content-type", format!("multipart/form-data; boundary={boundary}"))
            .body(body)
            .send()
            .await
            .expect("upload");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }
}

/// A workbook with a header row and data rows, as a user would fill the template.
fn workbook(rows: &[&[&str]]) -> Vec<u8> {
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    for (r, row) in rows.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            if !cell.is_empty() {
                sheet.write_string(r as u32, c as u16, *cell).unwrap();
            }
        }
    }
    book.save_to_buffer().unwrap()
}

#[tokio::test]
async fn the_import_takes_weekly_hours_and_refuses_an_old_template() {
    let Some(app) = TestApp::spawn().await else { return };

    let template = shift::services::xlsx_io::parse_header(
        &reqwest::Client::new()
            .get(format!("{}/employees/template", app.base_url))
            .header("x-access-token", app.token("shift-planner"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(template[2], "weekly_working_hours");

    let header = ["name", "email", "weekly_working_hours", "capabilities", "available_shifts"];
    let (status, result) = app
        .upload(
            "/employees/import",
            workbook(&[&header, &["Anna", "anna-import@test.invalid", "", "", ""], &["Ben", "ben-import@test.invalid", "30", "", ""]]),
        )
        .await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(2)), "{result}");
    let people = app.employees().await;
    assert_eq!(people["Anna"]["weekly_working_hours"], Value::Null, "empty cell follows the default");
    assert_eq!(people["Ben"]["weekly_working_hours"], 30.0);

    // Last version's template had monthly hours in that column.
    let old = ["name", "email", "max_working_hours", "capabilities", "available_shifts"];
    let (status, error) = app
        .upload("/employees/import", workbook(&[&old, &["Carla", "carla-import@test.invalid", "160", "", ""]]))
        .await;
    assert_eq!(status, 400, "{error}");
    assert!(error["error"].as_str().unwrap().contains("weekly_working_hours"), "{error}");
    assert!(!app.employees().await.contains_key("Carla"), "nothing imported from it");

    app.cleanup();
}
