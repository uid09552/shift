use std::time::Duration;

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::config::HolidayConfig;
use crate::errors::AppError;
use crate::repository::domain::{HolidayDomain, HolidayRepository};
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
    let holidays = fetch_year(&state.holiday_config, year).await?;
    let (from, to) = year_bounds(year);
    state.holiday_repo.replace_holidays(tenant_id, from, to, holidays.clone()).await?;
    Ok(holidays)
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
