use std::sync::Arc;
use async_trait::async_trait;
use diesel::prelude::*;

use crate::telemetry;
use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewPlannerSettings, PlannerSettings};
use crate::schema::planner_settings;
use super::domain::{MinStaffingMode, PlannerSettingsDomain, PlannerSettingsRepository, UpdatePlannerSettings};

#[derive(Clone)]
pub struct DieselPlannerSettingsRepository {
    pub pool: Arc<DbPool>,
}

fn to_domain(s: PlannerSettings) -> PlannerSettingsDomain {
    PlannerSettingsDomain {
        night_shift_recovery_days: s.night_shift_recovery_days,
        min_rest_hours: s.min_rest_hours,
        max_consecutive_days: s.max_consecutive_days,
        max_working_days_per_week: s.max_working_days_per_week,
        equality_weight: s.equality_weight,
        priority_weight_high: s.priority_weight_high,
        priority_weight_medium: s.priority_weight_medium,
        priority_weight_low: s.priority_weight_low,
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
        min_staffing_mode: MinStaffingMode::from_db(&s.min_staffing_mode),
        keep_fixed_assignments: s.keep_fixed_assignments,
        personal_limits_mode: MinStaffingMode::from_db_or(&s.personal_limits_mode, MinStaffingMode::Hard),
        default_weekly_working_hours: s.default_weekly_working_hours,
        publish_lead_days: s.publish_lead_days,
        freeze_days: s.freeze_days,
        change_weight: s.change_weight,
        labor_law_profile: s.labor_law_profile,
        labor_law_averaging_weeks: s.labor_law_averaging_weeks,
        use_case: s.use_case,
        auto_plan_enabled: s.auto_plan_enabled,
        auto_plan_every_weeks: s.auto_plan_every_weeks,
        auto_plan_weekday: s.auto_plan_weekday,
        auto_plan_time: s.auto_plan_time,
        auto_plan_start_date: s.auto_plan_start_date,
        auto_plan_range_unit: s.auto_plan_range_unit,
        auto_plan_range_count: s.auto_plan_range_count,
        auto_plan_armed_at: s.auto_plan_armed_at,
        auto_plan_last_run_on: s.auto_plan_last_run_on,
        auto_plan_last_outcome: s.auto_plan_last_outcome,
        auto_plan_last_note: s.auto_plan_last_note,
        auto_plan_last_task_id: s.auto_plan_last_task_id,
        auto_plan_last_started_at: s.auto_plan_last_started_at,
    }
}

/// Whether anything a planner sets about the schedule differs between the stored
/// row and the incoming values.
fn schedule_changed(stored: &PlannerSettings, new: &NewPlannerSettings) -> bool {
    stored.auto_plan_enabled != new.auto_plan_enabled
        || stored.auto_plan_every_weeks != new.auto_plan_every_weeks
        || stored.auto_plan_weekday != new.auto_plan_weekday
        || stored.auto_plan_time != new.auto_plan_time
        || stored.auto_plan_start_date != new.auto_plan_start_date
        || stored.auto_plan_range_unit != new.auto_plan_range_unit
        || stored.auto_plan_range_count != new.auto_plan_range_count
}

#[async_trait]
impl PlannerSettingsRepository for DieselPlannerSettingsRepository {
    async fn get_or_create_planner_settings(&self, tenant_id: &str) -> Result<PlannerSettingsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let existing = planner_settings::table
                .filter(planner_settings::tenant_id.eq(&tenant_id))
                .first::<PlannerSettings>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;
            if let Some(row) = existing {
                return Ok(to_domain(row));
            }

            let defaults = NewPlannerSettings::defaults(&tenant_id);
            let inserted: PlannerSettings = diesel::insert_into(planner_settings::table)
                .values(&defaults)
                .on_conflict(planner_settings::tenant_id)
                .do_update()
                .set(&defaults)
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(to_domain(inserted))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_auto_plan_enabled(&self) -> Result<Vec<(String, PlannerSettingsDomain)>, AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let rows = planner_settings::table
                .filter(planner_settings::auto_plan_enabled.eq(true))
                .load::<PlannerSettings>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(rows.into_iter().map(|r| (r.tenant_id.clone(), to_domain(r))).collect())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn claim_auto_plan_run(&self, tenant_id: &str, day: chrono::NaiveDate, now: chrono::NaiveDateTime) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let touched = diesel::update(
                planner_settings::table
                    .filter(planner_settings::tenant_id.eq(&tenant_id))
                    .filter(planner_settings::auto_plan_enabled.eq(true))
                    .filter(
                        planner_settings::auto_plan_last_run_on
                            .is_null()
                            .or(planner_settings::auto_plan_last_run_on.lt(day)),
                    ),
            )
            .set((
                planner_settings::auto_plan_last_run_on.eq(Some(day)),
                planner_settings::auto_plan_last_outcome.eq(Some("running")),
                planner_settings::auto_plan_last_note.eq(None::<String>),
                planner_settings::auto_plan_last_task_id.eq(None::<uuid::Uuid>),
                planner_settings::auto_plan_last_started_at.eq(Some(now)),
            ))
            .execute(&mut conn)
            .map_err(|_| AppError::DbError)?;
            Ok(touched == 1)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn set_auto_plan_outcome(&self, tenant_id: &str, outcome: &str, note: Option<String>, task_id: Option<uuid::Uuid>) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let outcome = outcome.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mine = planner_settings::table.filter(planner_settings::tenant_id.eq(&tenant_id));
            conn.transaction::<_, diesel::result::Error, _>(|conn| {
                diesel::update(mine.clone())
                    .set((
                        planner_settings::auto_plan_last_outcome.eq(Some(outcome)),
                        planner_settings::auto_plan_last_note.eq(note),
                    ))
                    .execute(conn)?;
                if let Some(task_id) = task_id {
                    diesel::update(mine).set(planner_settings::auto_plan_last_task_id.eq(Some(task_id))).execute(conn)?;
                }
                Ok(())
            })
            .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn fail_stale_auto_plan_runs(&self, cutoff: chrono::NaiveDateTime) -> Result<Vec<String>, AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                planner_settings::table
                    .filter(planner_settings::auto_plan_last_outcome.eq("running"))
                    .filter(planner_settings::auto_plan_last_started_at.lt(cutoff)),
            )
            .set((
                planner_settings::auto_plan_last_outcome.eq(Some("failed")),
                planner_settings::auto_plan_last_note.eq(Some("The planner did not answer in time")),
            ))
            .returning(planner_settings::tenant_id)
            .get_results::<String>(&mut conn)
            .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_planner_settings(&self, tenant_id: &str, settings: UpdatePlannerSettings) -> Result<PlannerSettingsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_settings = NewPlannerSettings {
                tenant_id: tenant_id.clone(),
                night_shift_recovery_days: settings.night_shift_recovery_days,
                min_rest_hours: settings.min_rest_hours,
                max_consecutive_days: settings.max_consecutive_days,
                max_working_days_per_week: settings.max_working_days_per_week,
                equality_weight: settings.equality_weight,
                priority_weight_high: settings.priority_weight_high,
                priority_weight_medium: settings.priority_weight_medium,
                priority_weight_low: settings.priority_weight_low,
                monthly_hours_target_weight: settings.monthly_hours_target_weight,
                solver_time_limit_seconds: settings.solver_time_limit_seconds,
                solver_num_workers: settings.solver_num_workers,
                weekly_min_hours: settings.weekly_min_hours,
                weekly_max_hours: settings.weekly_max_hours,
                weekly_hours_target_weight: settings.weekly_hours_target_weight,
                preference_weight: settings.preference_weight,
                skill_downgrade_weight: settings.skill_downgrade_weight,
                fatigue_weight: settings.fatigue_weight,
                night_shift_fatigue_multiplier: settings.night_shift_fatigue_multiplier,
                shift_continuity_weight: settings.shift_continuity_weight,
                shift_continuity_week_bonus: settings.shift_continuity_week_bonus,
                wish_weight: settings.wish_weight,
                min_staffing_mode: settings.min_staffing_mode.as_str().to_string(),
                keep_fixed_assignments: settings.keep_fixed_assignments,
                personal_limits_mode: settings.personal_limits_mode.as_str().to_string(),
                default_weekly_working_hours: settings.default_weekly_working_hours,
                publish_lead_days: settings.publish_lead_days,
                freeze_days: settings.freeze_days,
                change_weight: settings.change_weight,
                labor_law_profile: settings.labor_law_profile,
                labor_law_averaging_weeks: settings.labor_law_averaging_weeks,
                auto_plan_enabled: settings.auto_plan_enabled,
                auto_plan_every_weeks: settings.auto_plan_every_weeks,
                auto_plan_weekday: settings.auto_plan_weekday,
                auto_plan_time: settings.auto_plan_time,
                auto_plan_start_date: settings.auto_plan_start_date,
                auto_plan_range_unit: settings.auto_plan_range_unit.clone(),
                auto_plan_range_count: settings.auto_plan_range_count,
            };
            // The values and the use case they came from are saved together or not at all.
            let updated: PlannerSettings = conn
                .transaction::<_, diesel::result::Error, _>(|conn| {
                    let before: Option<PlannerSettings> = planner_settings::table
                        .filter(planner_settings::tenant_id.eq(&tenant_id))
                        .first(conn)
                        .optional()?;
                    let mut row: PlannerSettings = diesel::insert_into(planner_settings::table)
                        .values(&new_settings)
                        .on_conflict(planner_settings::tenant_id)
                        .do_update()
                        .set((&new_settings, planner_settings::updated_at.eq(diesel::dsl::now)))
                        .get_result(conn)?;
                    let mine = planner_settings::table.filter(planner_settings::tenant_id.eq(&tenant_id));
                    // The upsert skips a `None`, so a cleared start date is written here.
                    if row.auto_plan_start_date != new_settings.auto_plan_start_date {
                        row = diesel::update(mine.clone())
                            .set(planner_settings::auto_plan_start_date.eq(new_settings.auto_plan_start_date))
                            .get_result(conn)?;
                    }
                    // A run day whose time had passed before the schedule was switched on
                    // or changed must not run: note when that was, but only when it was.
                    let changed = before.as_ref().map_or(new_settings.auto_plan_enabled, |b| schedule_changed(b, &new_settings));
                    if changed {
                        row = diesel::update(mine.clone())
                            .set(planner_settings::auto_plan_armed_at.eq(Some(chrono::Local::now().naive_local())))
                            .get_result(conn)?;
                    }
                    // Left out of the upsert so that an omitted field keeps what is stored.
                    match &settings.use_case {
                        Some(use_case) => diesel::update(mine)
                            .set(planner_settings::use_case.eq(use_case.clone()))
                            .get_result(conn),
                        None => Ok(row),
                    }
                })
                .map_err(|_| AppError::DbError)?;
            Ok(to_domain(updated))
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
