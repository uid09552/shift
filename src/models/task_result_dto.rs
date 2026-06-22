use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TaskResultDto {
    pub status: String,
    #[serde(default)]
    pub objective_value: f64,
    pub planning_period: PlanningPeriodResult,
    #[serde(default)]
    pub schedule: Vec<DaySchedule>,
    #[serde(default)]
    pub employee_summary: Vec<EmployeeSummary>,
    #[serde(default)]
    pub employee_plans: Vec<serde_json::Value>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlanningPeriodResult {
    pub start_date: String,
    pub end_date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DaySchedule {
    pub date: String,
    pub weekday: String,
    pub shifts: Vec<ShiftSchedule>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftSchedule {
    pub shift_id: String,
    pub shift_name: String,
    pub assigned_dates: Vec<ShiftAssignment>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftAssignment {
    pub date: String,
    pub employee_id: String,
    pub employee_name: String,
    pub workstation_id: String,
    pub workstation_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct EmployeeSummary {
    pub employee_id: String,
    pub employee_name: String,
    pub total_shifts: i32,
    pub night_shifts: i32,
    pub total_working_hours: f64,
    pub per_shift: Vec<EmployeeShiftSummary>,
    pub assigned_dates: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EmployeeShiftSummary {
    pub shift_id: String,
    pub shift_name: String,
    pub total_assignments: i32,
    pub assigned_dates: Vec<String>,
}
