use serde::{Deserialize, Serialize};

/// Root model for the scheduling optimizer output.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TaskResultDto {
    pub status: String,
    pub objective_value: f64,
    pub planning_period: PlanningPeriodResult,
    pub schedule: Vec<DaySchedule>,
    pub employee_summary: Vec<EmployeeSummary>,
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

/// Per-employee summary across the planning period.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EmployeeSummary {
    pub employee_id: String,
    pub employee_name: String,
    pub total_shifts: i32,
    pub night_shifts: i32,
    pub total_working_hours: f64,
    pub per_shift: Vec<EmployeeShiftSummary>,
    pub assigned_dates: Vec<String>,
}

/// Per-shift breakdown within an employee summary.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EmployeeShiftSummary {
    pub shift_id: String,
    pub shift_name: String,
    pub total_assignments: i32,
    pub assigned_dates: Vec<String>,
}
