use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ConstraintTask {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monthly_hours_target_weight: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub night_shift_recovery_days: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_rest_hours: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_consecutive_days: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_working_days_per_week: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equality_weight: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority_weights: Option<std::collections::HashMap<String, i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solver_time_limit_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solver_num_workers: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekly_min_hours: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekly_max_hours: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekly_hours_target_weight: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preference_weight: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_downgrade_weight: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fatigue_weight: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub night_shift_fatigue_multiplier: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift_continuity_weight: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift_continuity_week_bonus: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wish_weight: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TaskDTO {
    pub planning_period: PlanningPeriod,
    pub shifts: Vec<ShiftTask>,
    pub workstations: Vec<WorkstationTask>,
    pub employees: Vec<EmployeeTask>,
    // Capability catalog with skill-level metadata (see CapabilityTask), used
    // by the optimizer's skill-downgrade objective. Capabilities without a
    // shared skill_group never substitute for one another, so tenants that
    // don't set skill_group see no change from a plain required-skills match.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<CapabilityTask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<ConstraintTask>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CapabilityTask {
    pub id: String,
    pub level: i16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_group: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlanningPeriod {
    pub start_date: String,
    pub end_date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftWeekdayTimeTask {
    pub weekday: String,
    pub start_time: String,
    pub end_time: String,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
    pub free_days_after_shift: i16,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftTask {
    pub id: String,
    pub name: String,
    pub is_night_shift: bool,
    pub weekday_times: Vec<ShiftWeekdayTimeTask>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkstationUnavailabilityRange {
    pub from_date: String,
    pub to_date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkstationTask {
    pub id: String,
    pub name: String,
    pub required_skills: Vec<String>,
    pub priority: String,
    pub operating_shifts: Vec<String>,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
    #[serde(default)]
    pub unavailability: Vec<WorkstationUnavailabilityRange>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PreferredOffTask {
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftWishTask {
    pub date: String,
    pub shift_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EmployeeTask {
    pub id: String,
    pub name: String,
    pub skills: Vec<String>,
    pub available_shifts: Vec<String>,
    pub unavailability: Vec<String>,
    pub monthly_working_hours: f64,
    // Days/shifts the employee would rather not work (soft — see
    // Unavailability.is_soft_preference). Never blocks assignment.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preferred_off: Vec<PreferredOffTask>,
    // Shifts the employee wishes to work on specific dates (soft — the
    // optimizer rewards fulfilling them via wish_weight, never forces them).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wishes: Vec<ShiftWishTask>,
}
