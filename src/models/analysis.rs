use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Result struct for planned hours per day per workstation analysis.
/// Computed in Rust from confirmed shift plans and shift weekday times.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkstationDailyHours {
    pub date: NaiveDate,
    pub workstation_id: Uuid,
    pub workstation_name: String,
    pub planned_hours: f64,
}

/// Result struct for planned employees per day per workstation analysis.
/// Computed in Rust from confirmed shift plans.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkstationDailyEmployees {
    pub date: NaiveDate,
    pub workstation_id: Uuid,
    pub workstation_name: String,
    pub planned_employees: i64,
}
