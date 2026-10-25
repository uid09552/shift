//! End-to-end tests for the spreadsheet imports: columns are found by header
//! whatever their order, language or position on the sheet, the user can assign
//! the ones nothing recognises, and a file that cannot be read is refused whole.
//!
//! Real router, real database, signed tokens (see `common`). Each test works in
//! its own throwaway tenant and deletes what it created. Needs PostgreSQL
//! (`DATABASE_URL`, or the development default); without one the tests print a
//! notice and pass.

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
use shift::schema::{audit_logs, capabilities, employees, shifts, workstations};

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
                eprintln!("skipping spreadsheet-import tests: no database ({e})");
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
            tenant: format!("test-import-{}", Uuid::new_v4()),
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

    async fn get(&self, path: &str) -> (u16, Value) {
        let response = reqwest::Client::new()
            .get(format!("{}{}", self.base_url, path))
            .header("x-access-token", self.token("shift-planner"))
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    /// The bytes of a download, as a planner.
    async fn download(&self, path: &str) -> Vec<u8> {
        reqwest::Client::new()
            .get(format!("{}{}", self.base_url, path))
            .header("x-access-token", self.token("shift-planner"))
            .send()
            .await
            .expect("download")
            .bytes()
            .await
            .expect("bytes")
            .to_vec()
    }

    /// POSTs `file` as a multipart upload, with any extra text parts, as `role`.
    async fn upload_as(&self, role: &str, path: &str, file: Vec<u8>, parts: &[(&str, &str)]) -> (u16, Value) {
        let boundary = format!("----test{}", Uuid::new_v4().simple());
        let mut body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"upload.xlsx\"\r\n\
             Content-Type: application/octet-stream\r\n\r\n"
        )
        .into_bytes();
        body.extend(file);
        body.extend(b"\r\n");
        for (name, value) in parts {
            body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").into_bytes());
        }
        body.extend(format!("--{boundary}--\r\n").into_bytes());
        let response = reqwest::Client::new()
            .post(format!("{}{}", self.base_url, path))
            .header("x-access-token", self.token(role))
            .header("content-type", format!("multipart/form-data; boundary={boundary}"))
            .body(body)
            .send()
            .await
            .expect("upload");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn upload(&self, path: &str, file: Vec<u8>) -> (u16, Value) {
        self.upload_as("shift-planner", path, file, &[]).await
    }

    /// Everything of one kind in the tenant, keyed by name.
    async fn named(&self, path: &str) -> std::collections::HashMap<String, Value> {
        let (status, list) = self.get(path).await;
        assert_eq!(status, 200, "{list}");
        list.as_array()
            .expect("a plain list")
            .iter()
            .map(|item| (item["name"].as_str().unwrap().to_string(), item.clone()))
            .collect()
    }

    /// Everyone, keyed by name (the employee list is paged).
    async fn employees(&self) -> std::collections::HashMap<String, Value> {
        let (status, page) = self.get("/employees?limit=100").await;
        assert_eq!(status, 200, "{page}");
        page["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| (e["name"].as_str().unwrap().to_string(), e.clone()))
            .collect()
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(employees::table.filter(employees::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(workstations::table.filter(workstations::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(shifts::table.filter(shifts::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(capabilities::table.filter(capabilities::tenant_id.eq(&self.tenant))).execute(&mut conn);
        let _ = diesel::delete(audit_logs::table.filter(audit_logs::tenant_id.eq(&self.tenant))).execute(&mut conn);
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

fn error_text(body: &Value) -> String {
    body["error"].as_str().unwrap_or_default().to_string()
}

// ── Shifts ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn shifts_are_read_by_german_headers_in_any_order_with_extra_columns_ignored() {
    let Some(app) = TestApp::spawn().await else { return };

    let file = workbook(&[
        &["Farbe", "Notiz", "Bezeichnung", "Kürzel", "Reihenfolge"],
        &["#3B82F6", "wichtig", "Frühdienst", "F", "2"],
        &["#10B981", "", "Spätdienst", "S", "3"],
    ]);
    let (status, result) = app.upload("/shifts/import", file).await;
    assert_eq!((status, result["created"].as_i64(), result["skipped"].as_i64()), (200, Some(2), Some(0)), "{result}");

    let shifts = app.named("/shifts").await;
    assert_eq!(shifts["Frühdienst"]["short_name"], "F");
    assert_eq!(shifts["Frühdienst"]["color"], "#3B82F6");
    assert_eq!(shifts["Frühdienst"]["order"], 2);
    assert_eq!(shifts["Spätdienst"]["short_name"], "S");

    app.cleanup();
}

#[tokio::test]
async fn the_shift_template_still_has_its_columns_and_imports_as_before() {
    let Some(app) = TestApp::spawn().await else { return };

    let template = app.download("/shifts/template").await;
    assert_eq!(shift::services::xlsx_io::parse_header(&template).unwrap(), ["name", "short_name", "color", "order"]);

    let file = workbook(&[&["name", "short_name", "color", "order"], &["Night", "N", "#6366F1", "4"]]);
    let (status, result) = app.upload("/shifts/import", file).await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(1)), "{result}");

    app.cleanup();
}

#[tokio::test]
async fn an_unrecognised_header_is_refused_until_the_user_assigns_it() {
    let Some(app) = TestApp::spawn().await else { return };
    let file = || workbook(&[&["Bezeichnung", "Kürzel", "Anzeige"], &["Early", "E", "#3B82F6"]]);

    let (status, error) = app.upload("/shifts/import", file()).await;
    assert_eq!(status, 400, "{error}");
    assert!(error_text(&error).contains("color"), "{error}");
    assert!(app.named("/shifts").await.is_empty(), "nothing imported from a file that cannot be read");

    let mapping = r##"{"columns": {"name": 0, "short_name": 1, "color": 2}}"##;
    let (status, result) = app.upload_as("shift-planner", "/shifts/import", file(), &[("mapping", mapping)]).await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(1)), "{result}");
    assert_eq!(app.named("/shifts").await["Early"]["color"], "#3B82F6");

    app.cleanup();
}

#[tokio::test]
async fn a_shift_file_without_its_required_columns_is_refused_naming_them() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, error) = app.upload("/shifts/import", workbook(&[&["Name"], &["Early"]])).await;
    assert_eq!(status, 400, "{error}");
    let message = error_text(&error);
    assert!(message.contains("short_name") && message.contains("color"), "{message}");
    assert!(app.named("/shifts").await.is_empty());

    app.cleanup();
}

#[tokio::test]
async fn errors_name_the_row_the_spreadsheet_shows() {
    let Some(app) = TestApp::spawn().await else { return };

    let file = workbook(&[
        &["Schichten 2026"],
        &[],
        &["name", "short_name", "color"],
        &["Early", "E", "#3B82F6"],
        &[],
        &["Late", "L", "blue"],
    ]);
    let (status, result) = app.upload("/shifts/import", file).await;
    assert_eq!((status, result["created"].as_i64(), result["skipped"].as_i64()), (200, Some(1), Some(1)), "{result}");
    assert_eq!(result["errors"][0]["row"], 6, "the bad color is on row 6 of the sheet");

    app.cleanup();
}

#[tokio::test]
async fn the_shift_preview_says_how_the_file_would_be_read_and_writes_nothing() {
    let Some(app) = TestApp::spawn().await else { return };

    let file = workbook(&[&["Farbe", "Bezeichnung", "Kürzel"], &["#3B82F6", "Early", "E"]]);
    let (status, preview) = app.upload("/shifts/import/preview", file).await;
    assert_eq!(status, 200, "{preview}");
    assert_eq!((preview["header_row"].as_i64(), preview["row_count"].as_i64()), (Some(1), Some(1)));
    assert_eq!(preview["columns"][0]["field"], "color");
    assert_eq!(preview["columns"][1]["field"], "name");
    assert_eq!(preview["columns"][2]["samples"], json!(["E"]));
    assert_eq!(preview["missing_required"], json!([]));
    assert!(app.named("/shifts").await.is_empty(), "a preview creates nothing");

    app.cleanup();
}

/// What the import dialog does: preview, then import with exactly what the
/// preview reported (its sheet, its 1-based header row, its detected columns).
#[tokio::test]
async fn importing_with_what_the_preview_reported_reads_the_same_rows() {
    let Some(app) = TestApp::spawn().await else { return };
    let file = || {
        workbook(&[
            &["Schichtliste"],
            &[],
            &["Farbe", "Bezeichnung", "Kürzel"],
            &["#3B82F6", "Early", "E"],
            &["#10B981", "Late", "L"],
        ])
    };

    let (status, preview) = app.upload("/shifts/import/preview", file()).await;
    assert_eq!(status, 200, "{preview}");
    assert_eq!(preview["header_row"], 3, "counted from 1, as the sheet shows it");

    let mut columns = serde_json::Map::new();
    for column in preview["columns"].as_array().unwrap() {
        if let Some(field) = column["field"].as_str() {
            columns.insert(field.to_string(), column["index"].clone());
        }
    }
    let mapping = json!({ "sheet": preview["sheet"], "header_row": preview["header_row"], "columns": columns }).to_string();

    let (status, result) = app.upload_as("shift-planner", "/shifts/import", file(), &[("mapping", &mapping)]).await;
    assert_eq!((status, result["created"].as_i64(), result["skipped"].as_i64()), (200, Some(2), Some(0)), "{result}");
    let shifts = app.named("/shifts").await;
    assert_eq!((shifts["Early"]["short_name"].as_str(), shifts["Late"]["color"].as_str()), (Some("E"), Some("#10B981")));

    app.cleanup();
}

// ── Capabilities ────────────────────────────────────────────────────────────

#[tokio::test]
async fn capabilities_skip_title_rows_and_extra_columns_and_the_duplicate_names_its_row() {
    let Some(app) = TestApp::spawn().await else { return };

    let file = workbook(&[
        &["Fähigkeiten"],
        &[],
        &["ID", "Name", "Kommentar"],
        &["1", "Intensive Care", "ICU"],
        &["2", "Intensive Care", "doppelt"],
    ]);
    let (status, result) = app.upload("/capabilities/import", file).await;
    assert_eq!((status, result["created"].as_i64(), result["skipped"].as_i64()), (200, Some(1), Some(1)), "{result}");
    assert_eq!(result["errors"][0]["row"], 5);
    assert!(app.named("/capabilities").await.contains_key("Intensive Care"));

    app.cleanup();
}

#[tokio::test]
async fn the_capability_template_still_has_its_one_column() {
    let Some(app) = TestApp::spawn().await else { return };
    let template = app.download("/capabilities/template").await;
    assert_eq!(shift::services::xlsx_io::parse_header(&template).unwrap(), ["name"]);
    app.cleanup();
}

#[tokio::test]
async fn an_ods_file_imports_like_an_xlsx() {
    let Some(app) = TestApp::spawn().await else { return };

    let ods = include_bytes!("fixtures/capabilities.ods").to_vec();
    let (status, result) = app.upload("/capabilities/import", ods).await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(2)), "{result}");
    let capabilities = app.named("/capabilities").await;
    assert!(capabilities.contains_key("Intensive Care") && capabilities.contains_key("Emergency Room"));

    app.cleanup();
}

#[tokio::test]
async fn a_file_that_is_not_a_spreadsheet_and_a_broken_mapping_are_refused() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, error) = app.upload("/capabilities/import", b"%PDF-1.7 not a spreadsheet".to_vec()).await;
    assert_eq!(status, 400, "{error}");
    assert!(error_text(&error).contains("spreadsheet"), "{error}");

    let file = || workbook(&[&["Name"], &["ICU"]]);
    let (status, error) = app.upload_as("shift-planner", "/capabilities/import", file(), &[("mapping", "{not json")]).await;
    assert_eq!(status, 400, "{error}");
    assert!(error_text(&error).contains("mapping"), "{error}");

    let (status, error) = app
        .upload_as("shift-planner", "/capabilities/import", file(), &[("mapping", r#"{"columns": {"name": 0, "bogus": 0}}"#)])
        .await;
    assert_eq!(status, 400, "{error}");
    let (status, error) = app
        .upload_as("shift-planner", "/capabilities/import", file(), &[("mapping", r#"{"sheet": "Nope"}"#)])
        .await;
    assert_eq!(status, 400, "{error}");
    assert!(app.named("/capabilities").await.is_empty(), "nothing imported from any of them");

    app.cleanup();
}

#[tokio::test]
async fn only_planners_and_admins_may_preview_or_import() {
    let Some(app) = TestApp::spawn().await else { return };
    let file = || workbook(&[&["Name"], &["ICU"]]);

    for path in ["/capabilities/import/preview", "/capabilities/import", "/shifts/import/preview"] {
        let (status, _) = app.upload_as("shift-viewer", path, file(), &[]).await;
        assert_eq!(status, 403, "a viewer must not reach {path}");
    }
    let (status, _) = app.upload_as("shift-planner", "/capabilities/import/preview", file(), &[]).await;
    assert_eq!(status, 200);
    assert!(app.named("/capabilities").await.is_empty());

    app.cleanup();
}

// ── Workstations ────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_workstation_file_with_only_a_name_column_gets_the_defaults() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, result) = app.upload("/workstations/import", workbook(&[&["Bezeichnung"], &["Notaufnahme"]])).await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(1)), "{result}");
    let ws = &app.named("/workstations").await["Notaufnahme"];
    assert_eq!((ws["priority"].as_str(), ws["min_employees"].as_i64(), ws["available"].as_bool()), (Some("medium"), Some(1), Some(true)));

    app.cleanup();
}

#[tokio::test]
async fn workstations_are_read_by_german_headers_and_yes_no_in_german() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, result) = app.upload("/shifts/import", workbook(&[&["name", "short_name", "color"], &["Early", "E", "#3B82F6"]])).await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(1)), "{result}");

    let file = workbook(&[
        &["Verfügbar", "Mindestbesetzung", "Bezeichnung", "Schichten", "Priorität"],
        &["nein", "2", "Intensiv", "Early", "high"],
        &["ja", "", "Ambulanz", "", ""],
    ]);
    let (status, result) = app.upload("/workstations/import", file).await;
    assert_eq!((status, result["created"].as_i64(), result["skipped"].as_i64()), (200, Some(2), Some(0)), "{result}");

    let stations = app.named("/workstations").await;
    assert_eq!((stations["Intensiv"]["available"].as_bool(), stations["Intensiv"]["min_employees"].as_i64()), (Some(false), Some(2)));
    assert_eq!(stations["Intensiv"]["priority"], "high");
    assert_eq!(stations["Intensiv"]["active_shift_ids"].as_array().unwrap().len(), 1, "the shift was found by name");
    assert_eq!(stations["Ambulanz"]["available"].as_bool(), Some(true));

    let (status, result) = app.upload("/workstations/import", workbook(&[&["name", "available"], &["Labor", "vielleicht"]])).await;
    assert_eq!((status, result["skipped"].as_i64()), (200, Some(1)), "an unknown yes/no is still a row error: {result}");

    app.cleanup();
}

#[tokio::test]
async fn the_workstation_template_still_has_its_columns_and_the_preview_names_them() {
    let Some(app) = TestApp::spawn().await else { return };

    let template = app.download("/workstations/template").await;
    let header = shift::services::xlsx_io::parse_header(&template).unwrap();
    assert_eq!(header, ["name", "priority", "min_employees", "max_employees", "available", "active_shifts", "required_capabilities"]);

    let (status, preview) = app.upload("/workstations/import/preview", template).await;
    assert_eq!(status, 200, "{preview}");
    let fields: Vec<_> = preview["columns"].as_array().unwrap().iter().map(|c| c["field"].as_str().unwrap().to_string()).collect();
    assert_eq!(fields, header, "every template column is recognised as itself");

    app.cleanup();
}

// ── Employees ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn employees_are_read_with_email_before_name_and_german_headers() {
    let Some(app) = TestApp::spawn().await else { return };

    let file = workbook(&[
        &["E-Mail", "Mitarbeiter", "Wochenstunden"],
        &["anna@clinic.test", "Anna Berg", "30"],
        &["ben@clinic.test", "Ben Kraft", ""],
    ]);
    let (status, result) = app.upload("/employees/import", file).await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(2)), "{result}");

    let people = app.employees().await;
    assert_eq!(people["Anna Berg"]["email"], "anna@clinic.test", "not 'Anna Berg' as the e-mail");
    assert_eq!(people["Anna Berg"]["weekly_working_hours"].as_f64(), Some(30.0));
    assert_eq!(people["Ben Kraft"]["weekly_working_hours"], Value::Null, "empty follows the default");

    app.cleanup();
}

#[tokio::test]
async fn an_academic_title_column_is_not_read_as_the_name() {
    let Some(app) = TestApp::spawn().await else { return };

    let file = workbook(&[&["Titel", "Name", "Mail"], &["Dr.", "Anna Berg", "anna@clinic.test"]]);
    let (status, result) = app.upload("/employees/import", file).await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(1)), "{result}");
    assert!(app.employees().await.contains_key("Anna Berg"));

    app.cleanup();
}

#[tokio::test]
async fn two_name_columns_are_refused_until_the_user_picks_one() {
    let Some(app) = TestApp::spawn().await else { return };
    let file = || workbook(&[&["Name", "Mitarbeiter", "Email"], &["Anna Berg", "A. Berg", "anna@clinic.test"]]);

    let (status, error) = app.upload("/employees/import", file()).await;
    assert_eq!(status, 400, "{error}");
    assert!(error_text(&error).contains("several columns match name"), "{error}");
    assert!(app.employees().await.is_empty());

    let mapping = r#"{"columns": {"name": 0, "email": 2}}"#;
    let (status, result) = app.upload_as("shift-planner", "/employees/import", file(), &[("mapping", mapping)]).await;
    assert_eq!((status, result["created"].as_i64()), (200, Some(1)), "{result}");
    assert!(app.employees().await.contains_key("Anna Berg"));

    app.cleanup();
}

#[tokio::test]
async fn the_old_monthly_hours_column_is_refused_wherever_it_sits_and_never_mapped() {
    let Some(app) = TestApp::spawn().await else { return };

    // First column, not the third where the old template had it.
    let moved = workbook(&[&["monthly_working_hours", "name", "email"], &["160", "Carla", "carla@clinic.test"]]);
    let (status, error) = app.upload("/employees/import", moved).await;
    assert_eq!(status, 400, "{error}");
    assert!(error_text(&error).contains("weekly_working_hours"), "{error}");

    // The user cannot assign it either.
    let old = || workbook(&[&["name", "email", "max_working_hours"], &["Carla", "carla@clinic.test", "160"]]);
    let mapping = r#"{"columns": {"name": 0, "email": 1, "weekly_working_hours": 2}}"#;
    let (status, error) = app.upload_as("shift-planner", "/employees/import", old(), &[("mapping", mapping)]).await;
    assert_eq!(status, 400, "{error}");
    assert!(error_text(&error).contains("weekly_working_hours"), "{error}");

    // The preview says so at once, rather than offering a mapping that cannot work.
    let (status, error) = app.upload("/employees/import/preview", old()).await;
    assert_eq!(status, 400, "{error}");

    assert!(!app.employees().await.contains_key("Carla"), "nothing imported from any of them");
    app.cleanup();
}

#[tokio::test]
async fn the_employee_template_keeps_its_columns() {
    let Some(app) = TestApp::spawn().await else { return };
    let template = app.download("/employees/template").await;
    assert_eq!(
        shift::services::xlsx_io::parse_header(&template).unwrap(),
        ["name", "email", "weekly_working_hours", "capabilities", "available_shifts"]
    );
    app.cleanup();
}

// ── Declarations ────────────────────────────────────────────────────────────

/// A header must mean one field only, or detection could not tell them apart.
#[test]
fn no_header_means_two_fields_of_the_same_entity() {
    use shift::services::xlsx_io::{normalize, ImportField};
    use shift::services::{capability, employee, shift as shift_service, workstation};

    let entities: [(&str, &[ImportField]); 4] = [
        ("shift", shift_service::IMPORT_FIELDS),
        ("capability", capability::IMPORT_FIELDS),
        ("workstation", workstation::IMPORT_FIELDS),
        ("employee", employee::IMPORT_FIELDS),
    ];
    for (entity, fields) in entities {
        let mut seen: std::collections::HashMap<String, &str> = std::collections::HashMap::new();
        for field in fields {
            let names = std::iter::once(normalize(field.key)).chain(field.aliases.iter().map(|a| a.to_string()));
            for name in names {
                assert_eq!(normalize(&name), name, "{entity}.{}: alias '{name}' is not in normalised form", field.key);
                if let Some(other) = seen.insert(name.clone(), field.key) {
                    assert_eq!(other, field.key, "{entity}: '{name}' is claimed by both {other} and {}", field.key);
                }
            }
        }
    }
}
