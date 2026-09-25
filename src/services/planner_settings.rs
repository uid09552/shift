use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::repository::domain::{MinStaffingMode, PlannerSettingsDomain, PlannerSettingsRepository, UpdatePlannerSettings};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
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
}

impl From<PlannerSettingsDomain> for PlannerSettingsResponse {
    fn from(s: PlannerSettingsDomain) -> Self {
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
}

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
    Ok(())
}
