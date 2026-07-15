use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::planner_settings;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = planner_settings)]
#[diesel(primary_key(tenant_id))]
pub struct PlannerSettings {
    pub tenant_id: String,
    pub night_shift_recovery_days: i16,
    pub min_rest_hours: f64,
    pub max_consecutive_days: i16,
    pub max_working_days_per_week: i16,
    pub equality_weight: i32,
    pub priority_weight_high: i32,
    pub priority_weight_medium: i32,
    pub priority_weight_low: i32,
    pub monthly_hours_target_weight: i32,
    pub solver_time_limit_seconds: f64,
    pub solver_num_workers: i16,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Insertable, AsChangeset, Debug, Clone)]
#[diesel(table_name = planner_settings)]
pub struct NewPlannerSettings {
    pub tenant_id: String,
    pub night_shift_recovery_days: i16,
    pub min_rest_hours: f64,
    pub max_consecutive_days: i16,
    pub max_working_days_per_week: i16,
    pub equality_weight: i32,
    pub priority_weight_high: i32,
    pub priority_weight_medium: i32,
    pub priority_weight_low: i32,
    pub monthly_hours_target_weight: i32,
    pub solver_time_limit_seconds: f64,
    pub solver_num_workers: i16,
}

impl NewPlannerSettings {
    /// Defaults mirror `ConstraintConfig` in `planner/shift_planner/models.py`.
    pub fn defaults(tenant_id: &str) -> Self {
        Self {
            tenant_id: tenant_id.to_string(),
            night_shift_recovery_days: 2,
            min_rest_hours: 11.0,
            max_consecutive_days: 6,
            max_working_days_per_week: 5,
            equality_weight: 50000,
            priority_weight_high: 10000,
            priority_weight_medium: 1000,
            priority_weight_low: 100,
            monthly_hours_target_weight: 1000,
            solver_time_limit_seconds: 120.0,
            solver_num_workers: 8,
        }
    }
}
