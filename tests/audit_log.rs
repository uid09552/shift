//! End-to-end tests for the audit log page's backend.
//!
//! `GET /audit-logs` filters by actor (any part of it, case-insensitive),
//! entity type and id, action and date; `GET /audit-logs/facets` lists what
//! occurs so the page can offer it. A delete keeps the deleted thing's name,
//! because "who deleted that workstation?" is asked after it is gone.
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
use shift::schema::{audit_logs, workstations};

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
                eprintln!("skipping audit log tests: no database ({e})");
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
            tenant: format!("test-audit-log-{}", Uuid::new_v4()),
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

    /// `actor` becomes the gateway's `X-Userinfo` header, which is where the
    /// audit log takes its "who" from.
    async fn request(&self, method: reqwest::Method, path: &str, actor: &str, body: Option<Value>) -> (u16, Value) {
        let userinfo = general_purpose::STANDARD.encode(json!({ "preferred_username": actor }).to_string());
        let mut request = reqwest::Client::new()
            .request(method, format!("{}{}", self.base_url, path))
            .header("x-access-token", self.token())
            .header("x-userinfo", userinfo);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn get(&self, path: &str) -> Value {
        let (status, body) = self.request(reqwest::Method::GET, path, "reader", None).await;
        assert_eq!(status, 200, "GET {path}: {body}");
        body
    }

    async fn create_workstation(&self, name: &str, actor: &str) -> String {
        let (status, body) = self
            .request(
                reqwest::Method::POST,
                "/workstations",
                actor,
                Some(json!({ "name": name, "available": true, "active_shift_ids": [] })),
            )
            .await;
        assert_eq!(status, 200, "body: {body}");
        body["id"].as_str().expect("workstation id").to_string()
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(audit_logs::table)
            .filter(audit_logs::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(workstations::table)
            .filter(workstations::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
    }
}

fn actions(page: &Value) -> Vec<String> {
    page["data"]
        .as_array()
        .expect("data")
        .iter()
        .map(|e| e["action"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[tokio::test]
async fn filters_by_actor_entity_and_keeps_the_name_of_what_was_deleted() {
    let Some(app) = TestApp::spawn().await else { return };

    let icu = app.create_workstation("ICU", "Anna.Mueller@clinic.test").await;
    app.create_workstation("ER", "ben@clinic.test").await;
    let (status, body) = app
        .request(reqwest::Method::DELETE, &format!("/workstations/{icu}"), "ben@clinic.test", None)
        .await;
    assert_eq!(status, 200, "delete: {body}");

    // Who deleted the ICU? The entry names it although the row is gone.
    let deletes = app.get("/audit-logs?action=workstation.delete").await;
    assert_eq!(deletes["total"], 1, "{deletes}");
    let entry = &deletes["data"][0];
    assert_eq!(entry["actor"], "ben@clinic.test");
    assert_eq!(entry["entity_id"], icu.as_str());
    let changes: Value = serde_json::from_str(entry["changes"].as_str().expect("changes")).expect("json");
    assert_eq!(changes["name"], "ICU");

    // Actor is matched on any part, ignoring case.
    let anna = app.get("/audit-logs?actor=anna").await;
    assert_eq!(actions(&anna), vec!["workstation.create"]);
    // "_" and "%" are literal: nobody's name contains "_".
    assert_eq!(app.get("/audit-logs?actor=_").await["total"], 0);

    // One entity's history, newest first.
    let history = app.get(&format!("/audit-logs?entity_type=workstation&entity_id={icu}")).await;
    assert_eq!(actions(&history), vec!["workstation.delete", "workstation.create"]);

    // Empty filter fields are ignored, as a cleared form sends them.
    let all = app.get("/audit-logs?actor=&action=&from_date=").await;
    assert_eq!(all["total"], 3);

    // A date range that ends before today finds nothing.
    assert_eq!(app.get("/audit-logs?to_date=2000-01-01").await["total"], 0);

    // Paging: total counts every match, data holds one page.
    let page = app.get("/audit-logs?limit=2&offset=2").await;
    assert_eq!(page["total"], 3);
    assert_eq!(page["data"].as_array().unwrap().len(), 1);

    let facets = app.get("/audit-logs/facets").await;
    assert_eq!(facets["actions"], json!(["workstation.create", "workstation.delete"]));
    assert_eq!(facets["entity_types"], json!(["workstation"]));
    assert_eq!(facets["actors"], json!(["Anna.Mueller@clinic.test", "ben@clinic.test"]));

    app.cleanup();
}
