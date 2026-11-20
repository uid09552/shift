//! The background refresh of public holidays (`holidays.refresh_interval_days`).
//!
//! Runs the real repository and `holiday::refresh_once` against a stub of the
//! holiday API: a year is fetched again once its interval has run out, not
//! before, a failing API is backed off instead of asked on every pass, and two
//! callers can never both claim the same year.
//!
//! Needs PostgreSQL; point `DATABASE_URL` at it, or leave it unset to use the
//! development default. With no database the tests print a notice and pass,
//! like the other integration tests.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::{extract::State, routing::get, Json, Router};
use chrono::{Datelike, Duration as ChronoDuration, NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::{json, Value};
use uuid::Uuid;

use shift::config::HolidayConfig;
use shift::database::DbPool;
use shift::repository::domain::{HolidayDomain, HolidayRepository};
use shift::repository::AppState;
use shift::services::holiday;

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

/// A stand-in for api-feiertage.de that counts its calls and can be made to fail.
#[derive(Clone)]
struct Api {
    calls: Arc<AtomicU32>,
    failing: Arc<AtomicBool>,
}

async fn serve_api() -> (String, Api) {
    let api = Api { calls: Arc::new(AtomicU32::new(0)), failing: Arc::new(AtomicBool::new(false)) };
    async fn handler(State(api): State<Api>) -> Result<Json<Value>, axum::http::StatusCode> {
        api.calls.fetch_add(1, Ordering::SeqCst);
        if api.failing.load(Ordering::SeqCst) {
            return Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        }
        let year = Utc::now().year();
        Ok(Json(json!({
            "status": "success",
            "feiertage": [{ "date": format!("{year}-01-01"), "fname": "Neujahr", "by": "1" }],
        })))
    }
    let app = Router::new().route("/", get(handler)).with_state(api.clone());
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await.expect("bind");
    let url = format!("http://{}", listener.local_addr().expect("addr"));
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (url, api)
}

/// One refresh pass covers every tenant that has holidays, so tests sharing a
/// database must not overlap: one test's pass would refresh another's tenant.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct Harness {
    _serial: tokio::sync::MutexGuard<'static, ()>,
    state: AppState,
    pool: DbPool,
    tenant: String,
    api: Api,
    year: i32,
}

impl Harness {
    async fn spawn(interval_days: u32) -> Option<Self> {
        let serial = ONE_AT_A_TIME.lock().await;
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(ConnectionManager::<PgConnection>::new(url))
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping holiday refresh tests: no database ({e})");
                return None;
            }
        };
        {
            // The tests of this file start together; migrating one fresh
            // database from several threads at once collides.
            static MIGRATING: std::sync::Mutex<()> = std::sync::Mutex::new(());
            let _guard = MIGRATING.lock().unwrap_or_else(|e| e.into_inner());
            shift::database::run_migrations(&pool).expect("migrations");
        }

        let (api_url, api) = serve_api().await;
        let mut state = AppState::new(Arc::new(pool.clone()));
        state.holiday_config = HolidayConfig {
            enabled: true,
            url: api_url,
            state: "by".into(),
            refresh_interval_days: interval_days,
            refresh_years_ahead: 0,
        };
        let tenant = format!("holiday-refresh-{}", Uuid::new_v4());
        let year = Utc::now().year();
        // The tenant already has this year's holidays, as after the first lazy fetch.
        state
            .holiday_repo
            .replace_holidays(
                &tenant,
                chrono::NaiveDate::from_ymd_opt(year, 1, 1).unwrap(),
                chrono::NaiveDate::from_ymd_opt(year, 12, 31).unwrap(),
                vec![HolidayDomain {
                    date: chrono::NaiveDate::from_ymd_opt(year, 1, 1).unwrap(),
                    name: "Neujahr".into(),
                    state: "by".into(),
                }],
            )
            .await
            .expect("seed holidays");
        Some(Self { _serial: serial, state, pool, tenant, api, year })
    }

    fn now() -> NaiveDateTime {
        Utc::now().naive_utc()
    }

    async fn history(&self) -> Option<shift::repository::domain::HolidaySyncDomain> {
        self.state.holiday_repo.get_holiday_sync(&self.tenant, self.year, "by").await.expect("history")
    }

    /// The year was last fetched `days` ago.
    async fn synced_days_ago(&self, days: i64) {
        let then = Self::now() - ChronoDuration::days(days);
        self.state.holiday_repo.record_holiday_sync(&self.tenant, self.year, "by", true, then).await.expect("record");
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        if let Ok(mut conn) = self.pool.get() {
            let _ = diesel::sql_query("DELETE FROM holiday_syncs WHERE tenant_id = $1")
                .bind::<diesel::sql_types::Text, _>(&self.tenant)
                .execute(&mut conn);
            let _ = diesel::sql_query("DELETE FROM public_holidays WHERE tenant_id = $1")
                .bind::<diesel::sql_types::Text, _>(&self.tenant)
                .execute(&mut conn);
            let _ = diesel::sql_query("DELETE FROM audit_logs WHERE tenant_id = $1")
                .bind::<diesel::sql_types::Text, _>(&self.tenant)
                .execute(&mut conn);
        }
    }
}

#[tokio::test]
async fn a_year_older_than_the_interval_is_fetched_again_and_then_left_alone() {
    let Some(h) = Harness::spawn(30).await else { return };
    h.synced_days_ago(40).await;

    holiday::refresh_once(&h.state).await;
    assert_eq!(h.api.calls.load(Ordering::SeqCst), 1, "40 days old, interval 30: fetched");
    let after = h.history().await.expect("history");
    assert!(after.last_synced_at.unwrap() > Harness::now() - ChronoDuration::minutes(5), "stamped just now");
    assert_eq!(after.consecutive_failures, 0);

    holiday::refresh_once(&h.state).await;
    assert_eq!(h.api.calls.load(Ordering::SeqCst), 1, "fresh now: not fetched again");
}

#[tokio::test]
async fn a_year_inside_the_interval_is_not_fetched() {
    let Some(h) = Harness::spawn(30).await else { return };
    h.synced_days_ago(10).await;

    holiday::refresh_once(&h.state).await;
    assert_eq!(h.api.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_interval_of_zero_never_refreshes() {
    let Some(h) = Harness::spawn(0).await else { return };
    h.synced_days_ago(4000).await;

    holiday::refresh_once(&h.state).await;
    assert_eq!(h.api.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_failing_api_is_backed_off_not_asked_on_every_pass() {
    let Some(h) = Harness::spawn(30).await else { return };
    h.synced_days_ago(40).await;
    h.api.failing.store(true, Ordering::SeqCst);

    holiday::refresh_once(&h.state).await;
    assert_eq!(h.api.calls.load(Ordering::SeqCst), 1, "due: asked once, and it failed");
    let failed = h.history().await.expect("history");
    assert_eq!(failed.consecutive_failures, 1);
    assert!(failed.last_synced_at.is_some(), "the earlier success is kept");

    holiday::refresh_once(&h.state).await;
    holiday::refresh_once(&h.state).await;
    assert_eq!(h.api.calls.load(Ordering::SeqCst), 1, "backing off: not asked again");

    // Once the back-off is over (15 min after one failure) and the API is back, it recovers.
    let long_ago = Harness::now() - ChronoDuration::minutes(20);
    h.state.holiday_repo.claim_holiday_sync(&h.tenant, h.year, "by", Some(failed.last_attempt_at), long_ago).await.expect("claim");
    h.api.failing.store(false, Ordering::SeqCst);
    holiday::refresh_once(&h.state).await;
    assert_eq!(h.api.calls.load(Ordering::SeqCst), 2);
    assert_eq!(h.history().await.expect("history").consecutive_failures, 0);
}

#[tokio::test]
async fn only_one_caller_can_claim_a_due_year() {
    let Some(h) = Harness::spawn(30).await else { return };
    h.synced_days_ago(40).await;
    let seen = h.history().await.expect("history").last_attempt_at;

    let first = h.state.holiday_repo.claim_holiday_sync(&h.tenant, h.year, "by", Some(seen), Harness::now()).await.expect("claim");
    let second = h.state.holiday_repo.claim_holiday_sync(&h.tenant, h.year, "by", Some(seen), Harness::now()).await.expect("claim");
    assert!(first, "the first instance gets it");
    assert!(!second, "the second finds the attempt time already moved");

    // A year never tried is claimed by whoever inserts first.
    let other = h.year + 1;
    assert!(h.state.holiday_repo.claim_holiday_sync(&h.tenant, other, "by", None, Harness::now()).await.expect("claim"));
    assert!(!h.state.holiday_repo.claim_holiday_sync(&h.tenant, other, "by", None, Harness::now()).await.expect("claim"));
}

#[tokio::test]
async fn an_automatic_refresh_leaves_an_audit_entry_from_the_holiday_sync_actor() {
    let Some(h) = Harness::spawn(30).await else { return };
    h.synced_days_ago(40).await;

    holiday::refresh_once(&h.state).await;

    let mut conn = h.pool.get().expect("conn");
    let rows: Vec<(Option<String>, String)> = diesel::sql_query(
        "SELECT actor, action FROM audit_logs WHERE tenant_id = $1",
    )
    .bind::<diesel::sql_types::Text, _>(&h.tenant)
    .load::<AuditRow>(&mut conn)
    .expect("audit rows")
    .into_iter()
    .map(|r| (r.actor, r.action))
    .collect();
    assert_eq!(rows, vec![(Some("holiday-sync".to_string()), "holidays.sync".to_string())]);
}

#[derive(diesel::QueryableByName)]
struct AuditRow {
    #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::Text>)]
    actor: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Text)]
    action: String,
}
