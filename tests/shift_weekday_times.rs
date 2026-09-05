//! End-to-end tests for a shift's weekday times, in particular the ones that
//! run past midnight.
//!
//! A weekday time is a start plus a duration, and the duration may cross into
//! the next day — stored as an `end_time` earlier than the `start_time`. Both
//! the analysis hour maths and the optimizer read it that way, so the API has
//! to keep accepting it; equal times are the one case with no reading and are
//! refused.
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
use shift::models::NewShift;
use shift::repository::AppState;
use shift::schema::{shift_weekday_times, shifts};

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

struct TestApp {
    base_url: String,
    tenant: String,
    shift_id: Uuid,
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
                eprintln!("skipping shift weekday-time tests: no database ({e})");
                return None;
            }
        };
        shift::database::run_migrations(&pool).expect("migrations");

        let tenant = format!("test-shift-times-{}", Uuid::new_v4());
        let mut conn = pool.get().expect("connection");
        let shift_id: Uuid = diesel::insert_into(shifts::table)
            .values(NewShift {
                name: "Night",
                short_name: "N",
                color: "#6366F1",
                order: 1,
                tenant_id: &tenant,
            })
            .returning(shifts::id)
            .get_result(&mut conn)
            .expect("insert shift");
        drop(conn);

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
            shift_id,
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

    async fn set_time(&self, weekday: i16, start: &str, end: &str) -> (u16, Value) {
        let response = reqwest::Client::new()
            .post(format!(
                "{}/shifts/{}/weekday-times",
                self.base_url, self.shift_id
            ))
            .header("x-access-token", self.token())
            .json(&json!({
                "weekday": weekday,
                "start_time": start,
                "end_time": end,
                "min_employees": 1,
            }))
            .send()
            .await
            .expect("POST weekday-times");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(shift_weekday_times::table)
            .filter(shift_weekday_times::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
        let _ = diesel::delete(shifts::table)
            .filter(shifts::tenant_id.eq(&self.tenant))
            .execute(&mut conn);
    }
}

#[tokio::test]
async fn a_shift_may_run_past_midnight() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, body) = app.set_time(0, "22:00", "06:00").await;
    assert_eq!(status, 200, "body: {body}");
    assert_eq!(body["start_time"], "22:00:00");
    assert_eq!(body["end_time"], "06:00:00", "the end stays on the next day");

    app.cleanup();
}

#[tokio::test]
async fn a_shift_may_end_exactly_at_midnight() {
    let Some(app) = TestApp::spawn().await else { return };

    let (status, body) = app.set_time(1, "16:00", "00:00").await;
    assert_eq!(status, 200, "body: {body}");
    assert_eq!(body["end_time"], "00:00:00");

    app.cleanup();
}

#[tokio::test]
async fn a_weekday_time_needs_a_start_and_a_different_end() {
    let Some(app) = TestApp::spawn().await else { return };

    // Zero hours and a full 24 look identical once stored, so neither reading
    // can be trusted and the write is refused.
    let (status, _) = app.set_time(2, "08:00", "08:00").await;
    assert!(
        (400..500).contains(&status),
        "expected a client error for equal times, got {status}"
    );

    app.cleanup();
}
