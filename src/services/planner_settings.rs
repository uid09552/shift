use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::repository::domain::{MinStaffingMode, PlannerSettingsDomain, PlannerSettingsRepository, UpdatePlannerSettings};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::auto_plan;
use chrono::Local;
use crate::services::tenant::TenantContext;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PriorityWeights {
    pub high: i32,
    pub medium: i32,
    pub low: i32,
}

#[derive(Serialize)]
pub struct PlannerSettingsResponse {
    pub night_shift_recovery_days: i16,
    pub min_rest_hours: f64,
    pub max_consecutive_days: i16,
    pub max_working_days_per_week: i16,
    pub equality_weight: i32,
    pub priority_weights: PriorityWeights,
    pub monthly_hours_target_weight: i32,
    pub solver_time_limit_seconds: f64,
    pub solver_num_workers: i16,
    pub updated_at: chrono::NaiveDateTime,
    pub weekly_min_hours: Option<f64>,
    pub weekly_max_hours: Option<f64>,
    pub weekly_hours_target_weight: i32,
    pub preference_weight: i32,
    pub skill_downgrade_weight: i32,
    pub fatigue_weight: i32,
    pub night_shift_fatigue_multiplier: f64,
    pub shift_continuity_weight: i32,
    pub shift_continuity_week_bonus: i32,
    pub wish_weight: i32,
    pub min_staffing_mode: MinStaffingMode,
    /// Rotations and other fixed assignments: kept first (`true`) or ignored.
    pub keep_fixed_assignments: bool,
    /// Employees' personal night/weekend limits: `hard` (default) or `soft`.
    pub personal_limits_mode: MinStaffingMode,
    /// Weekly hours of every employee without their own value (40 unless changed).
    pub default_weekly_working_hours: f64,
    /// A draft month is due for publishing this many days before it starts (28).
    pub publish_lead_days: i16,
    /// A change to a published month within this many days from today needs a reason (7, 0 = off).
    pub freeze_days: i16,
    /// A re-solve keeps the published roster, changing as few employee-days as
    /// coverage needs, when > 0; 0 ignores it.
    pub change_weight: i32,
    /// `none` (default) or `arbzg_de`: the legal rule set enforced as hard rules.
    pub labor_law_profile: String,
    /// Reference period of the 48 h weekly average, in weeks (24).
    pub labor_law_averaging_weeks: i16,
    /// The use case picked on the settings page (`balanced`, `fairness`, …), or null.
    /// A label: the optimizer never sees it.
    pub use_case: Option<String>,
    /// Automatic planning: on or off (off by default).
    pub auto_plan_enabled: bool,
    /// Runs every this many weeks (1–12), counted from `auto_plan_start_date`.
    pub auto_plan_every_weeks: i16,
    /// 0 = Monday … 6 = Sunday.
    pub auto_plan_weekday: i16,
    /// Server local time of the run, `HH:MM`.
    pub auto_plan_time: String,
    pub auto_plan_start_date: Option<chrono::NaiveDate>,
    /// `weeks` (2, 4, 6, 8, 12) or `months` (1, 2, 3).
    pub auto_plan_range_unit: String,
    pub auto_plan_range_count: i16,
    /// Read-only: when the schedule runs next (server local time), or null.
    pub auto_plan_next_run: Option<chrono::NaiveDateTime>,
    /// Read-only, written by the job: the run day last started and what came of it.
    pub auto_plan_last_run_on: Option<chrono::NaiveDate>,
    pub auto_plan_last_outcome: Option<String>,
    pub auto_plan_last_note: Option<String>,
    pub auto_plan_last_task_id: Option<uuid::Uuid>,
}

impl From<PlannerSettingsDomain> for PlannerSettingsResponse {
    fn from(s: PlannerSettingsDomain) -> Self {
        let auto_plan_next_run = auto_plan::next_run(&s, Local::now().naive_local(), s.auto_plan_armed_at);
        Self {
            night_shift_recovery_days: s.night_shift_recovery_days,
            min_rest_hours: s.min_rest_hours,
            max_consecutive_days: s.max_consecutive_days,
            max_working_days_per_week: s.max_working_days_per_week,
            equality_weight: s.equality_weight,
            priority_weights: PriorityWeights {
                high: s.priority_weight_high,
                medium: s.priority_weight_medium,
                low: s.priority_weight_low,
            },
            monthly_hours_target_weight: s.monthly_hours_target_weight,
            solver_time_limit_seconds: s.solver_time_limit_seconds,
            solver_num_workers: s.solver_num_workers,
            updated_at: s.updated_at,
            weekly_min_hours: s.weekly_min_hours,
            weekly_max_hours: s.weekly_max_hours,
            weekly_hours_target_weight: s.weekly_hours_target_weight,
            preference_weight: s.preference_weight,
            skill_downgrade_weight: s.skill_downgrade_weight,
            fatigue_weight: s.fatigue_weight,
            night_shift_fatigue_multiplier: s.night_shift_fatigue_multiplier,
            shift_continuity_weight: s.shift_continuity_weight,
            shift_continuity_week_bonus: s.shift_continuity_week_bonus,
            wish_weight: s.wish_weight,
            min_staffing_mode: s.min_staffing_mode,
            keep_fixed_assignments: s.keep_fixed_assignments,
            personal_limits_mode: s.personal_limits_mode,
            default_weekly_working_hours: s.default_weekly_working_hours,
            publish_lead_days: s.publish_lead_days,
            freeze_days: s.freeze_days,
            change_weight: s.change_weight,
            labor_law_profile: s.labor_law_profile,
            labor_law_averaging_weeks: s.labor_law_averaging_weeks,
            auto_plan_next_run,
            use_case: s.use_case,
            auto_plan_enabled: s.auto_plan_enabled,
            auto_plan_every_weeks: s.auto_plan_every_weeks,
            auto_plan_weekday: s.auto_plan_weekday,
            auto_plan_time: s.auto_plan_time.format("%H:%M").to_string(),
            auto_plan_start_date: s.auto_plan_start_date,
            auto_plan_range_unit: s.auto_plan_range_unit,
            auto_plan_range_count: s.auto_plan_range_count,
            auto_plan_last_run_on: s.auto_plan_last_run_on,
            auto_plan_last_outcome: s.auto_plan_last_outcome,
            auto_plan_last_note: s.auto_plan_last_note,
            auto_plan_last_task_id: s.auto_plan_last_task_id,
        }
    }
}

#[derive(Deserialize)]
pub struct UpdatePlannerSettingsRequest {
    pub night_shift_recovery_days: i16,
    pub min_rest_hours: f64,
    pub max_consecutive_days: i16,
    pub max_working_days_per_week: i16,
    pub equality_weight: i32,
    pub priority_weights: PriorityWeights,
    pub monthly_hours_target_weight: i32,
    pub solver_time_limit_seconds: f64,
    pub solver_num_workers: i16,
    #[serde(default)]
    pub weekly_min_hours: Option<f64>,
    #[serde(default)]
    pub weekly_max_hours: Option<f64>,
    #[serde(default = "default_weekly_hours_target_weight")]
    pub weekly_hours_target_weight: i32,
    #[serde(default = "default_preference_weight")]
    pub preference_weight: i32,
    #[serde(default = "default_skill_downgrade_weight")]
    pub skill_downgrade_weight: i32,
    #[serde(default = "default_fatigue_weight")]
    pub fatigue_weight: i32,
    #[serde(default = "default_night_shift_fatigue_multiplier")]
    pub night_shift_fatigue_multiplier: f64,
    #[serde(default = "default_shift_continuity_weight")]
    pub shift_continuity_weight: i32,
    #[serde(default = "default_shift_continuity_week_bonus")]
    pub shift_continuity_week_bonus: i32,
    #[serde(default = "default_wish_weight")]
    pub wish_weight: i32,
    #[serde(default = "default_min_staffing_mode")]
    pub min_staffing_mode: MinStaffingMode,
    #[serde(default = "default_keep_fixed_assignments")]
    pub keep_fixed_assignments: bool,
    #[serde(default = "default_personal_limits_mode")]
    pub personal_limits_mode: MinStaffingMode,
    #[serde(default = "default_weekly_working_hours")]
    pub default_weekly_working_hours: f64,
    #[serde(default = "default_publish_lead_days")]
    pub publish_lead_days: i16,
    #[serde(default = "default_freeze_days")]
    pub freeze_days: i16,
    #[serde(default = "default_change_weight")]
    pub change_weight: i32,
    #[serde(default = "default_labor_law_profile")]
    pub labor_law_profile: String,
    #[serde(default = "default_labor_law_averaging_weeks")]
    pub labor_law_averaging_weeks: i16,
    /// Omitted keeps the stored use case, `null` clears it, a string sets it.
    #[serde(default, deserialize_with = "keep_clear_or_set")]
    pub use_case: Option<Option<String>>,
    /// The schedule fields below are all optional: absent keeps what is stored.
    /// The status fields (`auto_plan_last_*`, `auto_plan_next_run`) are ignored.
    #[serde(default)]
    pub auto_plan_enabled: Option<bool>,
    #[serde(default)]
    pub auto_plan_every_weeks: Option<i16>,
    #[serde(default)]
    pub auto_plan_weekday: Option<i16>,
    #[serde(default)]
    pub auto_plan_time: Option<String>,
    /// `YYYY-MM-DD`; omitted keeps, `null` clears.
    #[serde(default, deserialize_with = "keep_clear_or_set")]
    pub auto_plan_start_date: Option<Option<String>>,
    #[serde(default)]
    pub auto_plan_range_unit: Option<String>,
    #[serde(default)]
    pub auto_plan_range_count: Option<i16>,
}

/// The schedule after a request: what was sent over what is stored.
struct Schedule {
    enabled: bool,
    every_weeks: i16,
    weekday: i16,
    time: chrono::NaiveTime,
    start_date: Option<chrono::NaiveDate>,
    range_unit: String,
    range_count: i16,
}

/// The eight ranges a planner may pick.
fn range_offered(unit: &str, count: i16) -> bool {
    match unit {
        "weeks" => matches!(count, 2 | 4 | 6 | 8 | 12),
        "months" => matches!(count, 1..=3),
        _ => false,
    }
}

fn merge_schedule(current: &PlannerSettingsDomain, body: &UpdatePlannerSettingsRequest) -> Result<Schedule, AppError> {
    let time = match &body.auto_plan_time {
        None => current.auto_plan_time,
        Some(text) => chrono::NaiveTime::parse_from_str(text, "%H:%M")
            .map_err(|_| AppError::Validation("auto_plan_time must be a time as HH:MM".into()))?,
    };
    let start_date = match &body.auto_plan_start_date {
        None => current.auto_plan_start_date,
        Some(None) => None,
        Some(Some(text)) => Some(
            chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("auto_plan_start_date must be a date as YYYY-MM-DD".into()))?,
        ),
    };
    let schedule = Schedule {
        enabled: body.auto_plan_enabled.unwrap_or(current.auto_plan_enabled),
        every_weeks: body.auto_plan_every_weeks.unwrap_or(current.auto_plan_every_weeks),
        weekday: body.auto_plan_weekday.unwrap_or(current.auto_plan_weekday),
        time,
        start_date,
        range_unit: body.auto_plan_range_unit.clone().unwrap_or_else(|| current.auto_plan_range_unit.clone()),
        range_count: body.auto_plan_range_count.unwrap_or(current.auto_plan_range_count),
    };
    if !(1..=12).contains(&schedule.every_weeks) {
        return Err(AppError::Validation("auto_plan_every_weeks must be between 1 and 12".into()));
    }
    if !(0..=6).contains(&schedule.weekday) {
        return Err(AppError::Validation("auto_plan_weekday must be between 0 (Monday) and 6 (Sunday)".into()));
    }
    if !range_offered(&schedule.range_unit, schedule.range_count) {
        return Err(AppError::Validation(
            "auto_plan_range must be 2, 4, 6, 8 or 12 weeks, or 1, 2 or 3 months".into(),
        ));
    }
    if schedule.enabled && schedule.start_date.is_none() {
        return Err(AppError::Validation("auto_plan_start_date is required while automatic planning is on".into()));
    }
    Ok(schedule)
}

/// Tells an absent field (`None`: keep) from an explicit `null` (`Some(None)`: clear).
/// A value that is not text becomes an empty id, which `validate` refuses with the
/// same 400 as any other bad id, instead of the framework's 422.
fn keep_clear_or_set<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(match <serde_json::Value as Deserialize>::deserialize(deserializer)? {
        serde_json::Value::Null => None,
        serde_json::Value::String(id) => Some(id),
        _ => Some(String::new()),
    }))
}

/// A use case is a short slug: the page's templates are constants in the UI, so
/// the server stores the label without knowing the set.
fn valid_use_case(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn default_labor_law_profile() -> String { "none".to_string() }
fn default_labor_law_averaging_weeks() -> i16 { 24 }

fn default_publish_lead_days() -> i16 { 28 }
fn default_freeze_days() -> i16 { 7 }
fn default_change_weight() -> i32 { 100000 }

fn default_weekly_working_hours() -> f64 { 40.0 }
fn default_weekly_hours_target_weight() -> i32 { 1000 }
fn default_preference_weight() -> i32 { 300 }
fn default_skill_downgrade_weight() -> i32 { 200 }
fn default_fatigue_weight() -> i32 { 100 }
fn default_night_shift_fatigue_multiplier() -> f64 { 2.0 }
fn default_shift_continuity_weight() -> i32 { 500 }
fn default_shift_continuity_week_bonus() -> i32 { 2000 }
fn default_wish_weight() -> i32 { 20000 }
fn default_min_staffing_mode() -> MinStaffingMode { MinStaffingMode::Soft }
fn default_keep_fixed_assignments() -> bool { true }
fn default_personal_limits_mode() -> MinStaffingMode { MinStaffingMode::Hard }

pub struct PlannerSettingsService;

impl PlannerSettingsService {
    pub async fn get_planner_settings(
        tenant: TenantContext,
        State(state): State<AppState>,
    ) -> Result<Json<PlannerSettingsResponse>, AppError> {
        let settings = state.planner_settings_repo.get_or_create_planner_settings(&tenant.0).await?;
        Ok(Json(settings.into()))
    }

    pub async fn update_planner_settings(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<UpdatePlannerSettingsRequest>,
    ) -> Result<Json<PlannerSettingsResponse>, AppError> {
        validate(&body)?;
        let current = state.planner_settings_repo.get_or_create_planner_settings(&tenant.0).await?;
        let schedule = merge_schedule(&current, &body)?;

        let update = UpdatePlannerSettings {
            night_shift_recovery_days: body.night_shift_recovery_days,
            min_rest_hours: body.min_rest_hours,
            max_consecutive_days: body.max_consecutive_days,
            max_working_days_per_week: body.max_working_days_per_week,
            equality_weight: body.equality_weight,
            priority_weight_high: body.priority_weights.high,
            priority_weight_medium: body.priority_weights.medium,
            priority_weight_low: body.priority_weights.low,
            monthly_hours_target_weight: body.monthly_hours_target_weight,
            solver_time_limit_seconds: body.solver_time_limit_seconds,
            solver_num_workers: body.solver_num_workers,
            weekly_min_hours: body.weekly_min_hours,
            weekly_max_hours: body.weekly_max_hours,
            weekly_hours_target_weight: body.weekly_hours_target_weight,
            preference_weight: body.preference_weight,
            skill_downgrade_weight: body.skill_downgrade_weight,
            fatigue_weight: body.fatigue_weight,
            night_shift_fatigue_multiplier: body.night_shift_fatigue_multiplier,
            shift_continuity_weight: body.shift_continuity_weight,
            shift_continuity_week_bonus: body.shift_continuity_week_bonus,
            wish_weight: body.wish_weight,
            min_staffing_mode: body.min_staffing_mode,
            keep_fixed_assignments: body.keep_fixed_assignments,
            personal_limits_mode: body.personal_limits_mode,
            default_weekly_working_hours: body.default_weekly_working_hours,
            publish_lead_days: body.publish_lead_days,
            freeze_days: body.freeze_days,
            change_weight: body.change_weight,
            labor_law_profile: body.labor_law_profile,
            labor_law_averaging_weeks: body.labor_law_averaging_weeks,
            use_case: body.use_case.clone(),
            auto_plan_enabled: schedule.enabled,
            auto_plan_every_weeks: schedule.every_weeks,
            auto_plan_weekday: schedule.weekday,
            auto_plan_time: schedule.time,
            auto_plan_start_date: schedule.start_date,
            auto_plan_range_unit: schedule.range_unit,
            auto_plan_range_count: schedule.range_count,
        };

        let settings = state.planner_settings_repo.update_planner_settings(&tenant.0, update).await?;
        let response = PlannerSettingsResponse::from(settings);

        let changes = serde_json::to_string(&response).unwrap_or_default();
        audit_log::record(&state, &tenant.0, actor.0, "planner_settings.update", "planner_settings", Some(tenant.0.clone()), Some(changes)).await;

        Ok(Json(response))
    }
}

fn validate(body: &UpdatePlannerSettingsRequest) -> Result<(), AppError> {
    if !(0..=7).contains(&body.night_shift_recovery_days) {
        return Err(AppError::Validation("night_shift_recovery_days must be between 0 and 7".into()));
    }
    if !(0.0..=24.0).contains(&body.min_rest_hours) {
        return Err(AppError::Validation("min_rest_hours must be between 0 and 24".into()));
    }
    if !(0..=14).contains(&body.max_consecutive_days) {
        return Err(AppError::Validation("max_consecutive_days must be between 0 and 14".into()));
    }
    if !(0..=7).contains(&body.max_working_days_per_week) {
        return Err(AppError::Validation("max_working_days_per_week must be between 0 and 7".into()));
    }
    if body.equality_weight < 0 {
        return Err(AppError::Validation("equality_weight must be >= 0".into()));
    }
    if body.priority_weights.high < 0 || body.priority_weights.medium < 0 || body.priority_weights.low < 0 {
        return Err(AppError::Validation("priority_weights must be >= 0".into()));
    }
    if body.monthly_hours_target_weight < 0 {
        return Err(AppError::Validation("monthly_hours_target_weight must be >= 0".into()));
    }
    if body.solver_time_limit_seconds <= 0.0 {
        return Err(AppError::Validation("solver_time_limit_seconds must be > 0".into()));
    }
    if !(1..=64).contains(&body.solver_num_workers) {
        return Err(AppError::Validation("solver_num_workers must be between 1 and 64".into()));
    }
    if let (Some(min_h), Some(max_h)) = (body.weekly_min_hours, body.weekly_max_hours) {
        if min_h > max_h {
            return Err(AppError::Validation("weekly_min_hours must be <= weekly_max_hours".into()));
        }
    }
    if body.weekly_min_hours.is_some_and(|v| v < 0.0) || body.weekly_max_hours.is_some_and(|v| v < 0.0) {
        return Err(AppError::Validation("weekly_min_hours/weekly_max_hours must be >= 0".into()));
    }
    if !(body.default_weekly_working_hours > 0.0 && body.default_weekly_working_hours <= 168.0) {
        return Err(AppError::Validation("default_weekly_working_hours must be greater than 0 and at most 168".into()));
    }
    if body.weekly_hours_target_weight < 0 {
        return Err(AppError::Validation("weekly_hours_target_weight must be >= 0".into()));
    }
    if body.preference_weight < 0 {
        return Err(AppError::Validation("preference_weight must be >= 0".into()));
    }
    if body.skill_downgrade_weight < 0 {
        return Err(AppError::Validation("skill_downgrade_weight must be >= 0".into()));
    }
    if body.fatigue_weight < 0 {
        return Err(AppError::Validation("fatigue_weight must be >= 0".into()));
    }
    if body.night_shift_fatigue_multiplier < 1.0 {
        return Err(AppError::Validation("night_shift_fatigue_multiplier must be >= 1.0".into()));
    }
    if body.shift_continuity_weight < 0 {
        return Err(AppError::Validation("shift_continuity_weight must be >= 0".into()));
    }
    if body.shift_continuity_week_bonus < 0 {
        return Err(AppError::Validation("shift_continuity_week_bonus must be >= 0".into()));
    }
    if body.wish_weight < 0 {
        return Err(AppError::Validation("wish_weight must be >= 0".into()));
    }
    if !(0..=366).contains(&body.publish_lead_days) {
        return Err(AppError::Validation("publish_lead_days must be between 0 and 366".into()));
    }
    if !(0..=366).contains(&body.freeze_days) {
        return Err(AppError::Validation("freeze_days must be between 0 and 366".into()));
    }
    if body.change_weight < 0 {
        return Err(AppError::Validation("change_weight must be >= 0".into()));
    }
    if !matches!(body.labor_law_profile.as_str(), "none" | "arbzg_de") {
        return Err(AppError::Validation("labor_law_profile must be 'none' or 'arbzg_de'".into()));
    }
    if let Some(Some(use_case)) = &body.use_case {
        if !valid_use_case(use_case) {
            return Err(AppError::Validation(
                "use_case must be 1 to 40 lowercase letters, digits, hyphens or underscores".into(),
            ));
        }
    }
    if !(1..=52).contains(&body.labor_law_averaging_weeks) {
        return Err(AppError::Validation("labor_law_averaging_weeks must be between 1 and 52".into()));
    }
    Ok(())
}
