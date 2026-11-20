use std::time::Duration;

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{Datelike, Duration as ChronoDuration, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::config::HolidayConfig;
use crate::errors::AppError;
use crate::repository::domain::{HolidayDomain, HolidayRepository, HolidaySyncDomain};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::TenantContext;

/// Public holidays of the configured state, fetched from the holiday API
/// (api-feiertage.de JSON) and kept per tenant. The planner treats a holiday
/// as a Sunday: the shift's Sunday times apply and it counts as a weekend day.
pub struct HolidayService;

#[derive(Deserialize, Debug)]
pub struct HolidayRangeQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Deserialize, Debug)]
pub struct SyncHolidaysQuery {
    /// Defaults to this year and the next.
    pub year: Option<i32>,
}

#[derive(Serialize, Debug)]
pub struct HolidaysResponse {
    pub state: String,
    pub enabled: bool,
    pub holidays: Vec<HolidayDomain>,
}

impl HolidayService {
    /// Holidays in `from..=to`. Years not stored yet are fetched first, so the
    /// calendar works without a manual sync.
    pub async fn list_holidays(
        tenant: TenantContext,
        State(state): State<AppState>,
        Query(q): Query<HolidayRangeQuery>,
    ) -> Result<Json<HolidaysResponse>, AppError> {
        if q.to < q.from || (q.to - q.from).num_days() > 3 * 366 {
            return Err(AppError::Validation("from..to must be a range of at most three years".into()));
        }
        ensure_range(&state, &tenant.0, q.from, q.to).await;
        let holidays = state.holiday_repo.list_holidays(&tenant.0, q.from, q.to).await?;
        Ok(Json(HolidaysResponse {
            state: state.holiday_config.state.clone(),
            enabled: state.holiday_config.enabled,
            holidays,
        }))
    }

    /// Fetches the given year (default: this and next) again and replaces what is stored.
    pub async fn sync_holidays(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Query(q): Query<SyncHolidaysQuery>,
    ) -> Result<Json<HolidaysResponse>, AppError> {
        if !state.holiday_config.enabled {
            return Err(AppError::Unavailable("Public holidays are switched off in the configuration".into()));
        }
        let this_year = Utc::now().year();
        let years = match q.year {
            Some(y) if !(2000..=2100).contains(&y) => {
                return Err(AppError::Validation("year must be between 2000 and 2100".into()));
            }
            Some(y) => vec![y],
            None => vec![this_year, this_year + 1],
        };

        let mut all = Vec::new();
        for year in years {
            all.extend(sync_year(&state, &tenant.0, year).await?);
        }

        let changes = serde_json::json!({ "state": state.holiday_config.state, "count": all.len() }).to_string();
        audit_log::record(&state, &tenant.0, actor.0, "holidays.sync", "public_holidays", None, Some(changes)).await;

        Ok(Json(HolidaysResponse {
            state: state.holiday_config.state.clone(),
            enabled: true,
            holidays: all,
        }))
    }
}

fn year_bounds(year: i32) -> (NaiveDate, NaiveDate) {
    (
        NaiveDate::from_ymd_opt(year, 1, 1).expect("valid date"),
        NaiveDate::from_ymd_opt(year, 12, 31).expect("valid date"),
    )
}

async fn sync_year(state: &AppState, tenant_id: &str, year: i32) -> Result<Vec<HolidayDomain>, AppError> {
    let result = fetch_and_store(state, tenant_id, year).await;
    // The outcome is what the refresh interval and the retry back-off read.
    // Failing to write it must not hide the fetch's own result.
    if let Err(e) = state
        .holiday_repo
        .record_holiday_sync(tenant_id, year, &state.holiday_config.state, result.is_ok(), now())
        .await
    {
        eprintln!("Holidays: could not record the sync of {year} for tenant {tenant_id}: {e}");
    }
    result
}

async fn fetch_and_store(state: &AppState, tenant_id: &str, year: i32) -> Result<Vec<HolidayDomain>, AppError> {
    let holidays = fetch_year(&state.holiday_config, year).await?;
    let (from, to) = year_bounds(year);
    state.holiday_repo.replace_holidays(tenant_id, from, to, holidays.clone()).await?;
    Ok(holidays)
}

/// UTC, as the sync history stores it.
fn now() -> NaiveDateTime {
    Utc::now().naive_utc()
}

/// First wait after a failed fetch; doubles with every further failure.
const RETRY_BASE_MINUTES: i64 = 15;
/// A failing holiday API is asked at most once a day.
const RETRY_MAX_MINUTES: i64 = 24 * 60;

/// How long to leave a year alone after `failures` failed fetches in a row:
/// 15 min, 30 min, 1 h, … up to a day. Nothing after a success.
pub fn retry_delay(failures: i32) -> ChronoDuration {
    if failures <= 0 {
        return ChronoDuration::zero();
    }
    let doublings = (failures - 1).min(10) as u32;
    ChronoDuration::minutes((RETRY_BASE_MINUTES << doublings).min(RETRY_MAX_MINUTES))
}

/// Whether a failed fetch is recent enough that this year should not be
/// fetched again yet.
pub fn backing_off(sync: Option<&HolidaySyncDomain>, now: NaiveDateTime) -> bool {
    sync.is_some_and(|s| s.consecutive_failures > 0 && now < s.last_attempt_at + retry_delay(s.consecutive_failures))
}

/// Whether the background refresh should fetch a year again: it has been
/// fetched before, the last success is `interval_days` or more old, and a
/// failure is not still backing off. `0` days switches the refresh off. A year
/// that was never fetched is the lazy path's business, not the refresh's.
pub fn refresh_due(sync: Option<&HolidaySyncDomain>, now: NaiveDateTime, interval_days: u32) -> bool {
    let Some(sync) = sync else { return false };
    if interval_days == 0 || backing_off(Some(sync), now) {
        return false;
    }
    match sync.last_synced_at {
        Some(at) => now >= at + ChronoDuration::days(i64::from(interval_days)),
        // Holidays are stored but the history never recorded a success (data
        // from before sync history existed): treat the year as due once.
        None => true,
    }
}

/// Fetches every year of the range that has no holidays stored for the
/// configured state. Failures are logged, not raised: a holiday API that is
/// down must not stop planning or the calendar.
pub async fn ensure_range(state: &AppState, tenant_id: &str, from: NaiveDate, to: NaiveDate) {
    if !state.holiday_config.enabled {
        return;
    }
    for year in from.year()..=to.year() {
        let (start, end) = year_bounds(year);
        let stored = state
            .holiday_repo
            .count_holidays(tenant_id, start, end, &state.holiday_config.state)
            .await;
        if matches!(stored, Ok(0)) {
            // A failed fetch is not retried on every request, only once its back-off is over.
            let history = state.holiday_repo.get_holiday_sync(tenant_id, year, &state.holiday_config.state).await.ok().flatten();
            if backing_off(history.as_ref(), now()) {
                continue;
            }
            if let Err(e) = sync_year(state, tenant_id, year).await {
                eprintln!("Holidays: could not fetch {year} for tenant {tenant_id}: {e}");
            }
        }
    }
}

/// The dates of the holidays in the range, for the optimizer.
pub async fn dates_in_range(
    state: &AppState,
    tenant_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<NaiveDate>, AppError> {
    if !state.holiday_config.enabled {
        return Ok(Vec::new());
    }
    ensure_range(state, tenant_id, from, to).await;
    Ok(state
        .holiday_repo
        .list_holidays(tenant_id, from, to)
        .await?
        .into_iter()
        .map(|h| h.date)
        .collect())
}

/// How often the background refresh looks for years that are due. Cheap: one
/// query per tenant and year, a fetch only when the interval has run out.
const REFRESH_TICK: Duration = Duration::from_secs(60 * 60);
/// The most years after the current one the refresh will cover.
const MAX_YEARS_AHEAD: u32 = 3;
/// Audit actor of the automatic refresh.
const REFRESH_ACTOR: &str = "holiday-sync";

/// Starts the background refresh (`holidays.refresh_interval_days`). Does
/// nothing while holidays are switched off or the interval is `0`.
pub fn spawn(state: AppState) {
    if !state.holiday_config.enabled || state.holiday_config.refresh_interval_days == 0 {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(REFRESH_TICK);
        loop {
            tick.tick().await;
            refresh_once(&state).await;
        }
    });
}

/// One pass over every tenant that has holidays: each year from this one to
/// `refresh_years_ahead` later is fetched again when it is due.
pub async fn refresh_once(state: &AppState) {
    let config = &state.holiday_config;
    if !config.enabled || config.refresh_interval_days == 0 {
        return;
    }
    let tenants = match state.holiday_repo.list_holiday_tenants().await {
        Ok(tenants) => tenants,
        Err(e) => {
            eprintln!("Holidays: could not list tenants to refresh: {e}");
            return;
        }
    };
    let this_year = Utc::now().year();
    let last_year = this_year + config.refresh_years_ahead.min(MAX_YEARS_AHEAD) as i32;
    for tenant in tenants {
        for year in this_year..=last_year {
            refresh_year(state, &tenant, year).await;
        }
    }
}

async fn refresh_year(state: &AppState, tenant: &str, year: i32) {
    let config = &state.holiday_config;
    let history = match state.holiday_repo.get_holiday_sync(tenant, year, &config.state).await {
        Ok(history) => history,
        Err(e) => return eprintln!("Holidays: could not read the sync history of {year} for tenant {tenant}: {e}"),
    };
    let at = now();
    if !refresh_due(history.as_ref(), at, config.refresh_interval_days) {
        return;
    }
    // Another instance may have got here first; only one of them fetches.
    let claimed = state
        .holiday_repo
        .claim_holiday_sync(tenant, year, &config.state, history.as_ref().map(|h| h.last_attempt_at), at)
        .await;
    if !matches!(claimed, Ok(true)) {
        return;
    }
    let outcome = sync_year(state, tenant, year).await;
    let changes = match &outcome {
        Ok(holidays) => serde_json::json!({ "state": config.state, "year": year, "count": holidays.len(), "trigger": "schedule" }),
        Err(e) => serde_json::json!({ "state": config.state, "year": year, "error": e.to_string(), "trigger": "schedule" }),
    };
    if let Err(e) = &outcome {
        eprintln!("Holidays: refresh of {year} for tenant {tenant} failed: {e}");
    }
    audit_log::record(state, tenant, Some(REFRESH_ACTOR.into()), "holidays.sync", "public_holidays", None, Some(changes.to_string())).await;
}

async fn fetch_year(config: &HolidayConfig, year: i32) -> Result<Vec<HolidayDomain>, AppError> {
    let code = config.state.trim().to_ascii_lowercase();
    if code.len() != 2 || !code.chars().all(|c| c.is_ascii_lowercase()) {
        return Err(AppError::Validation(format!("Holiday state '{}' is not a two-letter state code", config.state)));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::Internal)?;
    let response = client
        .get(config.url.trim())
        .query(&[("states", code.as_str()), ("years", &year.to_string())])
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Unavailable(format!("Holiday API unreachable: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::Unavailable(format!("Holiday API answered {}", response.status())));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Unavailable(format!("Holiday API sent invalid JSON: {e}")))?;
    parse_holidays(&body, &code)
}

/// Reads api-feiertage.de's `{"status": "success", "feiertage": [{"date", "fname",
/// "<state>": "1"|"0", …}]}`. An entry flagged "0" for the state is skipped.
fn parse_holidays(body: &serde_json::Value, state: &str) -> Result<Vec<HolidayDomain>, AppError> {
    if body.get("status").and_then(|s| s.as_str()).is_some_and(|s| s != "success") {
        return Err(AppError::Unavailable("Holiday API reported an error".into()));
    }
    let entries = body
        .get("feiertage")
        .and_then(|f| f.as_array())
        .ok_or_else(|| AppError::Unavailable("Holiday API response has no 'feiertage' list".into()))?;

    let mut out: Vec<HolidayDomain> = Vec::new();
    for entry in entries {
        let Some(date) = entry
            .get("date")
            .and_then(|d| d.as_str())
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        else {
            continue;
        };
        let applies = match entry.get(state) {
            Some(flag) => flag.as_str() == Some("1") || flag.as_i64() == Some(1) || flag.as_bool() == Some(true),
            None => true,
        };
        if !applies || out.iter().any(|h| h.date == date) {
            continue;
        }
        let name = entry
            .get("fname")
            .and_then(|n| n.as_str())
            .map(|n| n.split_whitespace().collect::<Vec<_>>().join(" "))
            .unwrap_or_else(|| "Public holiday".to_string());
        out.push(HolidayDomain { date, name, state: state.to_string() });
    }
    out.sort_by_key(|h| h.date);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").unwrap()
    }

    fn history(synced: Option<&str>, attempt: &str, failures: i32) -> HolidaySyncDomain {
        HolidaySyncDomain { last_synced_at: synced.map(at), last_attempt_at: at(attempt), consecutive_failures: failures }
    }

    #[test]
    fn the_retry_delay_doubles_from_fifteen_minutes_up_to_a_day() {
        assert_eq!(retry_delay(0), ChronoDuration::zero());
        assert_eq!(retry_delay(1), ChronoDuration::minutes(15));
        assert_eq!(retry_delay(2), ChronoDuration::minutes(30));
        assert_eq!(retry_delay(3), ChronoDuration::minutes(60));
        assert_eq!(retry_delay(8), ChronoDuration::minutes(24 * 60), "capped at a day");
        assert_eq!(retry_delay(500), ChronoDuration::minutes(24 * 60), "and it cannot overflow");
    }

    #[test]
    fn a_failed_fetch_backs_off_until_its_delay_is_over() {
        let failed = history(None, "2026-11-10 10:00", 1);
        assert!(backing_off(Some(&failed), at("2026-11-10 10:14")));
        assert!(!backing_off(Some(&failed), at("2026-11-10 10:15")));
        assert!(!backing_off(None, at("2026-11-10 10:00")), "never tried: nothing to back off from");
        assert!(!backing_off(Some(&history(Some("2026-11-10 09:00"), "2026-11-10 10:00", 0)), at("2026-11-10 10:01")), "a success never backs off");
    }

    #[test]
    fn the_refresh_waits_for_the_interval_after_the_last_success() {
        let synced = history(Some("2026-10-01 03:00"), "2026-10-01 03:00", 0);
        assert!(!refresh_due(Some(&synced), at("2026-10-30 12:00"), 30), "29 days");
        assert!(refresh_due(Some(&synced), at("2026-10-31 03:00"), 30), "30 days to the minute");
        assert!(refresh_due(Some(&synced), at("2026-12-01 00:00"), 30));
    }

    #[test]
    fn an_interval_of_zero_never_refreshes() {
        let old = history(Some("2020-01-01 00:00"), "2020-01-01 00:00", 0);
        assert!(!refresh_due(Some(&old), at("2026-11-10 10:00"), 0));
    }

    #[test]
    fn a_year_never_fetched_is_left_to_the_lazy_path() {
        assert!(!refresh_due(None, at("2026-11-10 10:00"), 30));
    }

    #[test]
    fn a_failing_refresh_is_retried_with_back_off_not_every_tick() {
        // Fetched long ago, last attempt failed 10 minutes ago.
        let failing = history(Some("2026-01-01 00:00"), "2026-11-10 10:00", 1);
        assert!(!refresh_due(Some(&failing), at("2026-11-10 10:10"), 30));
        assert!(refresh_due(Some(&failing), at("2026-11-10 10:15"), 30));
    }

    #[test]
    fn stored_holidays_without_a_recorded_success_are_refreshed_once() {
        let unknown = history(None, "2026-11-01 00:00", 0);
        assert!(refresh_due(Some(&unknown), at("2026-11-10 10:00"), 30));
    }

    #[test]
    fn keeps_only_holidays_of_the_state() {
        let body = serde_json::json!({
            "status": "success",
            "feiertage": [
                { "date": "2026-01-01", "fname": "Neujahr", "by": "1", "be": "1" },
                { "date": "2026-03-08", "fname": "Frauentag", "by": "0", "be": "1" },
                { "date": "2026-01-06", "fname": "Heilige\nDrei Könige", "by": "1", "be": "0" },
            ]
        });
        let parsed = parse_holidays(&body, "by").unwrap();
        let dates: Vec<String> = parsed.iter().map(|h| h.date.to_string()).collect();
        assert_eq!(dates, vec!["2026-01-01", "2026-01-06"]);
        assert_eq!(parsed[1].name, "Heilige Drei Könige");
    }

    #[test]
    fn an_error_status_is_refused() {
        let body = serde_json::json!({ "status": "error" });
        assert!(parse_holidays(&body, "by").is_err());
    }
}
