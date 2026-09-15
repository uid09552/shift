//! GET /api/v1/info: what is running. Readable by every role, like any GET.
//!
//! Needs PostgreSQL only because the router needs a pool; point `DATABASE_URL`
//! at it, or leave it unset to use the development default. When no database
//! is reachable the test prints a notice and passes, matching `wish_window.rs`.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::PgConnection;
use serde_json::{json, Value};

use shift::database::DbPool;
use shift::repository::AppState;

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

fn viewer_token() -> String {
    let payload = json!({
        "tenant": ["test-info"],
        "realm_access": { "roles": ["shift-viewer"] },
        "email": "viewer@test.invalid",
    });
    let encode = |bytes: &[u8]| general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    format!(
        "{}.{}.signature",
        encode(br#"{"alg":"RS256","typ":"JWT"}"#),
        encode(payload.to_string().as_bytes()),
    )
}

#[tokio::test]
async fn info_reports_the_running_version_to_any_role() {
    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
    let pool: DbPool = match Pool::builder()
        .max_size(2)
        .connection_timeout(Duration::from_secs(2))
        .build(ConnectionManager::<PgConnection>::new(url))
    {
        Ok(pool) => pool,
        Err(e) => {
            eprintln!("skipping info test: no database ({e})");
            return;
        }
    };

    let app = shift::server::create_router(AppState::new(Arc::new(pool)));
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let response = reqwest::Client::new()
        .get(format!("http://{addr}/api/v1/info"))
        .header("x-access-token", viewer_token())
        .send()
        .await
        .expect("GET /info");
    assert_eq!(response.status().as_u16(), 200);

    let body: Value = response.json().await.expect("json");
    assert_eq!(body["name"], "shift-backend");
    assert!(!body["version"].as_str().unwrap_or("").is_empty(), "body: {body}");
    assert!(body["commit"].is_string() && body["build_date"].is_string(), "body: {body}");
}
