//! End-to-end tests for `GET /self`: who the caller is.
//!
//! The identity comes from the token's claims, so a caller that did not pass
//! the gateway (the MCP server) still learns it; the gateway's X-Userinfo adds
//! to it. `employee_id` is the caller's own employee, matched by e-mail or
//! username.
//!
//! Needs PostgreSQL; point `DATABASE_URL` at it, or leave it unset to use the
//! development default. When no database is reachable the tests print a notice
//! and pass rather than failing, matching `wish_window.rs`.

mod common;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::{json, Value};
use uuid::Uuid;

use common::TestKeys;
use shift::database::DbPool;
use shift::repository::AppState;

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
        let manager = ConnectionManager::<PgConnection>::new(url);
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(manager)
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping self tests: no database ({e})");
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
            tenant: format!("test-self-{}", Uuid::new_v4()),
            keys,
            pool,
        })
    }

    fn token(&self, email: &str, role: &str) -> String {
        self.keys.sign(json!({
            "sub": format!("sub-{email}"),
            "tenant": [self.tenant],
            "realm_access": { "roles": [role] },
            "email": email,
            "preferred_username": email,
        }))
    }

    async fn get_self(&self, email: &str, role: &str, userinfo: Option<Value>) -> Value {
        let mut request = reqwest::Client::new()
            .get(format!("{}/self", self.base_url))
            .header("x-access-token", self.token(email, role));
        if let Some(info) = userinfo {
            request = request.header("x-userinfo", general_purpose::STANDARD.encode(info.to_string()));
        }
        let response = request.send().await.expect("request");
        assert_eq!(response.status().as_u16(), 200);
        response.json().await.expect("json")
    }

    fn employee(&self, name: &str, email: &str) -> Uuid {
        let id = Uuid::new_v4();
        let mut conn = self.pool.get().expect("connection");
        diesel::sql_query(format!(
            "INSERT INTO employees (id, name, email, tenant_id) VALUES ('{id}', '{name}', '{email}', '{}')",
            self.tenant
        ))
        .execute(&mut conn)
        .expect("insert employee");
        id
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::sql_query(format!("DELETE FROM employees WHERE tenant_id = '{}'", self.tenant)).execute(&mut conn);
    }
}

#[tokio::test]
async fn self_works_without_the_gateway_and_names_the_callers_employee() {
    let Some(app) = TestApp::spawn().await else { return };
    let anna = app.employee("Anna", "anna@clinic.test");

    // No X-Userinfo, as from the MCP server: identity from the token itself.
    let viewer = app.get_self("anna@clinic.test", "shift-viewer", None).await;
    assert_eq!(viewer["email"], "anna@clinic.test");
    assert_eq!(viewer["preferred_username"], "anna@clinic.test");
    assert_eq!(viewer["sub"], "sub-anna@clinic.test");
    assert_eq!(viewer["roles"], json!(["shift-viewer"]));
    assert_eq!(viewer["employee_id"], anna.to_string());

    // Nobody by that address: no employee, the rest unchanged.
    let admin = app.get_self("admin@clinic.test", "shift-admin", None).await;
    assert!(admin["employee_id"].is_null(), "{admin}");
    assert_eq!(admin["email"], "admin@clinic.test");
    assert_eq!(admin["roles"], json!(["shift-admin"]));

    // Through the gateway, its user info adds the names.
    let named = app
        .get_self("anna@clinic.test", "shift-viewer", Some(json!({ "name": "Anna Müller", "given_name": "Anna" })))
        .await;
    assert_eq!(named["name"], "Anna Müller");
    assert_eq!(named["email"], "anna@clinic.test", "kept from the token");
    assert_eq!(named["employee_id"], anna.to_string());

    app.cleanup();
}
