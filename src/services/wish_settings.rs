use axum::{extract::State, Json};
use chrono::{NaiveDate, NaiveDateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::repository::domain::{
    ScheduleUnit, UpdateWishSettings, WishMode, WishScheduleDomain, WishSettingsDomain, WishSettingsRepository,
};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::{RoleContext, TenantContext};

/// The tenant's shift-wish window, as the API returns it.
#[derive(Serialize, Debug)]
pub struct WishSettingsResponse {
    pub mode: WishMode,
    pub window_start: Option<NaiveDate>,
    pub window_end: Option<NaiveDate>,
    pub schedule: WishScheduleResponse,
    pub updated_at: NaiveDateTime,
}

#[derive(Serialize, Debug)]
pub struct WishScheduleResponse {
    #[serde(flatten)]
    pub schedule: WishScheduleDomain,
    /// The next time the schedule flips the window (UTC); None while switched off.
    pub next_change_at: Option<NaiveDateTime>,
    pub next_change_opens: Option<bool>,
}

impl From<WishSettingsDomain> for WishSettingsResponse {
    fn from(s: WishSettingsDomain) -> Self {
        let next = s
            .schedule
            .enabled
            .then(|| s.schedule.next_change(Utc::now().naive_utc()))
            .flatten();
        Self {
            mode: s.mode,
            window_start: s.window_start,
            window_end: s.window_end,
            schedule: WishScheduleResponse {
                schedule: s.schedule,
                next_change_at: next.map(|(at, _)| at),
                next_change_opens: next.map(|(_, opens)| opens),
            },
            updated_at: s.updated_at,
        }
    }
}

#[derive(Deserialize, Debug)]
pub struct UpdateWishSettingsRequest {
    pub mode: WishMode,
    #[serde(default)]
    pub window_start: Option<NaiveDate>,
    #[serde(default)]
    pub window_end: Option<NaiveDate>,
    /// Left out = keep the stored schedule.
    #[serde(default)]
    pub schedule: Option<UpdateWishScheduleRequest>,
}

#[derive(Deserialize, Debug)]
pub struct UpdateWishScheduleRequest {
    pub enabled: bool,
    pub unit: ScheduleUnit,
    pub interval: i32,
    #[serde(default)]
    pub weekday: i16,
    #[serde(default = "first_of_month")]
    pub day_of_month: i16,
    pub time: NaiveTime,
    pub open_days: i32,
    /// Defaults to today (UTC).
    #[serde(default)]
    pub start_date: Option<NaiveDate>,
}

fn first_of_month() -> i16 {
    1
}

pub struct WishSettingsService;

impl WishSettingsService {
    /// Readable by every role: the UI needs the window to decide whether to offer the
    /// wish picker, and employees are shown why wishing is closed.
    pub async fn get_wish_settings(
        tenant: TenantContext,
        State(state): State<AppState>,
    ) -> Result<Json<WishSettingsResponse>, AppError> {
        let settings = state.wish_settings_repo.get_or_create_wish_settings(&tenant.0).await?;
        Ok(Json(settings.into()))
    }

    /// Writable by `shift-admin` only. The role middleware lets any writer through
    /// (it only knows the method), so the narrower check happens here.
    pub async fn update_wish_settings(
        tenant: TenantContext,
        roles: RoleContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<UpdateWishSettingsRequest>,
    ) -> Result<Json<WishSettingsResponse>, AppError> {
        if !roles.is_admin() {
            return Err(AppError::Forbidden(
                "Only shift-admin may change the shift-wish window".into(),
            ));
        }
        validate(&body)?;

        let update = UpdateWishSettings {
            mode: body.mode,
            window_start: body.window_start,
            window_end: body.window_end,
        };

        let mut settings = state.wish_settings_repo.update_wish_settings(&tenant.0, update).await?;
        if let Some(schedule) = body.schedule {
            let schedule = WishScheduleDomain {
                enabled: schedule.enabled,
                unit: schedule.unit,
                interval: schedule.interval,
                weekday: schedule.weekday,
                day_of_month: schedule.day_of_month,
                time: schedule.time,
                open_days: schedule.open_days,
                start_date: schedule.start_date.or_else(|| Some(Utc::now().date_naive())),
                applied_open: None,
            };
            settings = state.wish_settings_repo.update_wish_schedule(&tenant.0, schedule).await?;
        }
        let response = WishSettingsResponse::from(settings);

        let changes = serde_json::to_string(&response).unwrap_or_default();
        audit_log::record(&state, &tenant.0, actor.0, "wish_settings.update", "wish_settings", Some(tenant.0.clone()), Some(changes)).await;

        Ok(Json(response))
    }
}

/// The window is kept even while `enabled`/`disabled` is active, so switching back to
/// `date_range` does not lose it — only `date_range` requires it to be complete.
fn validate(body: &UpdateWishSettingsRequest) -> Result<(), AppError> {
    if body.mode == WishMode::DateRange && (body.window_start.is_none() || body.window_end.is_none()) {
        return Err(AppError::Validation(
            "window_start and window_end are required when mode is 'date_range'".into(),
        ));
    }
    if let (Some(start), Some(end)) = (body.window_start, body.window_end) {
        if start > end {
            return Err(AppError::Validation("window_start must be on or before window_end".into()));
        }
    }
    if let Some(s) = &body.schedule {
        validate_schedule(s)?;
    }
    Ok(())
}

fn validate_schedule(s: &UpdateWishScheduleRequest) -> Result<(), AppError> {
    let max_interval = match s.unit {
        ScheduleUnit::Days => 365,
        ScheduleUnit::Weeks => 52,
        ScheduleUnit::Months => 24,
    };
    if s.interval < 1 || s.interval > max_interval {
        return Err(AppError::Validation(format!("interval must be between 1 and {max_interval}")));
    }
    if !(0..=6).contains(&s.weekday) {
        return Err(AppError::Validation("weekday must be between 0 (Monday) and 6 (Sunday)".into()));
    }
    if !(1..=31).contains(&s.day_of_month) {
        return Err(AppError::Validation("day_of_month must be between 1 and 31".into()));
    }
    if !(1..=366).contains(&s.open_days) {
        return Err(AppError::Validation("open_days must be between 1 and 366".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(mode: WishMode, start: Option<&str>, end: Option<&str>) -> UpdateWishSettingsRequest {
        let date = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        UpdateWishSettingsRequest {
            mode,
            window_start: start.map(date),
            window_end: end.map(date),
            schedule: None,
        }
    }

    fn settings(mode: WishMode, start: Option<&str>, end: Option<&str>) -> WishSettingsDomain {
        let date = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        WishSettingsDomain {
            mode,
            window_start: start.map(date),
            window_end: end.map(date),
            schedule: WishScheduleDomain::default(),
            updated_at: NaiveDateTime::default(),
        }
    }

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn date_range_needs_both_bounds() {
        assert!(validate(&request(WishMode::DateRange, Some("2026-10-01"), Some("2026-10-31"))).is_ok());
        assert!(validate(&request(WishMode::DateRange, Some("2026-10-01"), None)).is_err());
        assert!(validate(&request(WishMode::DateRange, None, None)).is_err());
    }

    #[test]
    fn other_modes_keep_an_incomplete_window() {
        assert!(validate(&request(WishMode::Enabled, None, None)).is_ok());
        assert!(validate(&request(WishMode::Disabled, Some("2026-10-01"), None)).is_ok());
    }

    #[test]
    fn window_must_not_be_inverted() {
        assert!(validate(&request(WishMode::DateRange, Some("2026-10-31"), Some("2026-10-01"))).is_err());
        assert!(validate(&request(WishMode::Enabled, Some("2026-10-31"), Some("2026-10-01"))).is_err());
    }

    #[test]
    fn enabled_allows_every_date_disabled_none() {
        let open = settings(WishMode::Enabled, None, None);
        let closed = settings(WishMode::Disabled, Some("2026-10-01"), Some("2026-10-31"));

        assert!(open.allows_wish_on(day("2026-01-01")));
        assert!(!closed.allows_wish_on(day("2026-10-15")));
    }

    #[test]
    fn date_range_allows_the_window_inclusively() {
        let window = settings(WishMode::DateRange, Some("2026-10-01"), Some("2026-10-31"));

        assert!(window.allows_wish_on(day("2026-10-01")));
        assert!(window.allows_wish_on(day("2026-10-31")));
        assert!(!window.allows_wish_on(day("2026-09-30")));
        assert!(!window.allows_wish_on(day("2026-11-01")));
    }

    #[test]
    fn date_range_without_bounds_is_closed() {
        assert!(!settings(WishMode::DateRange, None, None).allows_wish_on(day("2026-10-15")));
        assert!(!settings(WishMode::DateRange, Some("2026-10-01"), None).allows_wish_on(day("2026-10-15")));
    }

    #[test]
    fn unknown_stored_mode_closes_the_window() {
        assert_eq!(WishMode::from_db("enabled"), WishMode::Enabled);
        assert_eq!(WishMode::from_db("date_range"), WishMode::DateRange);
        assert_eq!(WishMode::from_db("nonsense"), WishMode::Disabled);
    }
}
