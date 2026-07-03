use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ConstraintTask {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monthly_hours_target_weight: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TaskDTO {
    pub planning_period: PlanningPeriod,
    pub shifts: Vec<ShiftTask>,
    pub workstations: Vec<WorkstationTask>,
    pub employees: Vec<EmployeeTask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<ConstraintTask>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlanningPeriod {
    pub start_date: String,
    pub end_date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftTask {
    pub id: String,
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub weekdays: Vec<String>,
    pub is_night_shift: bool,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
    pub free_days_after_shift: i16,
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
pub struct EmployeeTask {
    pub id: String,
    pub name: String,
    pub skills: Vec<String>,
    pub available_shifts: Vec<String>,
    pub unavailability: Vec<String>,
    pub monthly_working_hours: f64,
}
