use std::sync::Arc;
use async_trait::async_trait;
use diesel::prelude::*;
use tokio::task;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewPlannerSettings, PlannerSettings};
use crate::schema::planner_settings;
use super::domain::{PlannerSettingsDomain, PlannerSettingsRepository, UpdatePlannerSettings};

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
    }
}

#[async_trait]
impl PlannerSettingsRepository for DieselPlannerSettingsRepository {
    async fn get_or_create_planner_settings(&self, tenant_id: &str) -> Result<PlannerSettingsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
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

    async fn update_planner_settings(&self, tenant_id: &str, settings: UpdatePlannerSettings) -> Result<PlannerSettingsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
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
            };
            let updated: PlannerSettings = diesel::insert_into(planner_settings::table)
                .values(&new_settings)
                .on_conflict(planner_settings::tenant_id)
                .do_update()
                .set((&new_settings, planner_settings::updated_at.eq(diesel::dsl::now)))
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(to_domain(updated))
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
