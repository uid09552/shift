use chrono::NaiveDate;
use chrono::NaiveTime;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::errors::AppError;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Employee {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub monthly_working_hours: f64,
    pub available_shifts: Vec<Shift>,
    pub capabilities: Vec<Capability>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WeekdayTime {
    pub weekday: i16,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
    pub free_days_after_shift: i16,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Shift {
    pub id: Uuid,
    pub name: String,
    pub short_name: String,
    pub color: String,
    pub order: i32,
    pub weekday_times: Vec<WeekdayTime>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Capability {
    pub id: Uuid,
    pub name: String,
    // Ordinal skill level (1 = base) and optional skill_group; see
    // models::Capability. Defaulted so callers that don't care about
    // skill-downgrade tracking can keep constructing `Capability { id, name }`.
    #[serde(default = "default_capability_level")]
    pub level: i16,
    #[serde(default)]
    pub skill_group: Option<String>,
}

fn default_capability_level() -> i16 {
    1
}

impl Default for Capability {
    fn default() -> Self {
        Self { id: Uuid::nil(), name: String::new(), level: 1, skill_group: None }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Workstation {
    pub id: Uuid,
    pub name: String,
    pub available: bool,
    pub active_shift_ids: Vec<Uuid>,
    pub required_capabilities: Vec<Capability>,
    pub priority: String,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Unavailability {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub unavailable_date: NaiveDate,
    pub shift_id: Option<Uuid>,
    // Soft when true: the optimizer may still assign this day/shift under
    // pressure, at a penalty, instead of hard-blocking it.
    #[serde(default)]
    pub is_soft_preference: bool,
}

// An employee's wish to work a specific shift on a specific date. Stored
// separately from confirmed plans — the optimizer treats wishes as a soft
// reward (wish_weight) and the calendar marks them specially.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftWish {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub shift_id: Uuid,
    pub wish_date: NaiveDate,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkstationUnavailability {
    pub id: Uuid,
    pub workstation_id: Uuid,
    pub unavailable_from: NaiveDate,
    pub unavailable_to: NaiveDate,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
/// A fixed assignment: this person works this shift on this day — or, with
/// no shift, has this day off. Rotation patterns write these; the planner keeps
/// them ahead of every other goal.
pub struct EmployeeShiftAssignment {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub shift_id: Option<Uuid>,
    pub date: NaiveDate,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConfirmedShiftPlan {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub shift_id: Option<Uuid>,
    pub workstation_id: Option<Uuid>,
    pub date: NaiveDate,
    pub is_present: bool,
    pub absence_type: Option<String>,
    pub creation_type: String,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OptimizedShiftResultDomain {
    pub id: Uuid,
    pub result: serde_json::Value,
    pub creation_date: chrono::NaiveDateTime,
}

// Repository traits
use async_trait::async_trait;

#[async_trait]
    pub trait EmployeeRepository {
        async fn create_employee(&self, tenant_id: &str, name: &str, email: &str, monthly_working_hours: f64) -> Result<Employee, AppError>;
        async fn get_employee(&self, tenant_id: &str, id: Uuid) -> Result<Option<Employee>, AppError>;
        async fn get_employee_by_email(&self, tenant_id: &str, email: &str) -> Result<Option<Employee>, AppError>;
        async fn list_employees(&self, tenant_id: &str, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<Employee>, AppError>;
        async fn list_employees_by_ids(&self, tenant_id: &str, ids: &[Uuid]) -> Result<Vec<Employee>, AppError>;
        async fn count_employees(&self, tenant_id: &str) -> Result<i64, AppError>;
        async fn get_employee_capabilities(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<Capability>, AppError>;
        async fn add_employee_capability(&self, tenant_id: &str, employee_id: Uuid, capability_id: Uuid) -> Result<(), AppError>;
        async fn update_employee(&self, tenant_id: &str, employee: Employee) -> Result<(), AppError>;
        async fn delete_employee(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
        async fn get_employee_available_shifts(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<Shift>, AppError>;
        async fn add_employee_available_shift(&self, tenant_id: &str, employee_id: Uuid, shift_id: Uuid) -> Result<(), AppError>;
    }

#[async_trait]
    pub trait ShiftRepository {
        async fn create_shift(&self, tenant_id: &str, name: &str, short_name: &str, color: &str, order: i32) -> Result<Shift, AppError>;
    async fn get_shift(&self, tenant_id: &str, id: Uuid) -> Result<Option<Shift>, AppError>;
    async fn list_shifts(&self, tenant_id: &str) -> Result<Vec<Shift>, AppError>;
    async fn update_shift(&self, tenant_id: &str, id: Uuid, name: Option<String>, short_name: Option<String>, color: Option<String>, order: Option<i32>) -> Result<Shift, AppError>;
    async fn delete_shift(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
}

#[async_trait]
pub trait CapabilityRepository {
    async fn create_capability(&self, tenant_id: &str, name: &str, level: i16, skill_group: Option<&str>) -> Result<Capability, AppError>;
    async fn get_capability(&self, tenant_id: &str, id: Uuid) -> Result<Option<Capability>, AppError>;
    async fn list_capabilities(&self, tenant_id: &str) -> Result<Vec<Capability>, AppError>;
    async fn update_capability(&self, tenant_id: &str, id: Uuid, name: &str, level: i16, skill_group: Option<&str>) -> Result<Capability, AppError>;
    async fn delete_capability(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
}

#[async_trait]
pub trait UnavailabilityRepository {
    async fn create_unavailability(&self, tenant_id: &str, unavailability: Unavailability) -> Result<Unavailability, AppError>;
    async fn get_unavailability(&self, tenant_id: &str, id: Uuid) -> Result<Option<Unavailability>, AppError>;
    async fn list_unavailabilities(&self, tenant_id: &str) -> Result<Vec<Unavailability>, AppError>;
    async fn get_unavailabilities_for_employee(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<Unavailability>, AppError>;
    async fn delete_unavailability(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
}

#[async_trait]
pub trait ShiftWishRepository {
    async fn create_shift_wish(&self, tenant_id: &str, wish: ShiftWish) -> Result<ShiftWish, AppError>;
    async fn get_shift_wish(&self, tenant_id: &str, id: Uuid) -> Result<Option<ShiftWish>, AppError>;
    async fn list_shift_wishes(&self, tenant_id: &str) -> Result<Vec<ShiftWish>, AppError>;
    async fn get_shift_wishes_for_employee(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<ShiftWish>, AppError>;
    async fn delete_shift_wish(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
}

#[async_trait]
pub trait WorkstationRepository {
    async fn create_workstation(&self, tenant_id: &str, name: &str, available: bool, active_shift_ids: Vec<Uuid>, priority: &str, min_employees: i16, max_employees: Option<i16>) -> Result<Workstation, AppError>;
    async fn get_workstation(&self, tenant_id: &str, id: Uuid) -> Result<Option<Workstation>, AppError>;
    async fn list_workstations(&self, tenant_id: &str) -> Result<Vec<Workstation>, AppError>;
    async fn set_workstation_availability(&self, tenant_id: &str, id: Uuid, available: bool) -> Result<(), AppError>;
    async fn set_workstation_active_shifts(&self, tenant_id: &str, id: Uuid, active_shift_ids: Vec<Uuid>) -> Result<(), AppError>;
    async fn set_workstation_priority(&self, tenant_id: &str, id: Uuid, priority: &str) -> Result<(), AppError>;
    async fn set_workstation_staffing(&self, tenant_id: &str, id: Uuid, min_employees: i16, max_employees: Option<i16>) -> Result<(), AppError>;
    async fn add_required_capability(&self, tenant_id: &str, workstation_id: Uuid, capability_id: Uuid) -> Result<(), AppError>;
    async fn list_required_capabilities(&self, tenant_id: &str, workstation_id: Uuid) -> Result<Vec<Capability>, AppError>;
    async fn delete_workstation(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
    async fn remove_required_capability(&self, tenant_id: &str, workstation_id: Uuid, capability_id: Uuid) -> Result<(), AppError>;
}

#[async_trait]
pub trait WorkstationUnavailabilityRepository {
    async fn create_workstation_unavailability(&self, tenant_id: &str, unavailability: WorkstationUnavailability) -> Result<WorkstationUnavailability, AppError>;
    async fn get_workstation_unavailability(&self, tenant_id: &str, id: Uuid) -> Result<Option<WorkstationUnavailability>, AppError>;
    async fn list_workstation_unavailabilities(&self, tenant_id: &str) -> Result<Vec<WorkstationUnavailability>, AppError>;
    async fn get_unavailabilities_for_workstation(&self, tenant_id: &str, workstation_id: Uuid) -> Result<Vec<WorkstationUnavailability>, AppError>;
    async fn delete_workstation_unavailability(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
}

#[async_trait]
pub trait EmployeeShiftAssignmentRepository {
    async fn create_assignment(&self, tenant_id: &str, assignment: EmployeeShiftAssignment) -> Result<EmployeeShiftAssignment, AppError>;
    async fn get_assignments_for_employee(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<EmployeeShiftAssignment>, AppError>;
    async fn get_assignments_for_employee_in_range(&self, tenant_id: &str, employee_id: Uuid, from_date: NaiveDate, to_date: NaiveDate) -> Result<Vec<EmployeeShiftAssignment>, AppError>;
    async fn delete_assignment(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
    /// Everyone's fixed assignments in the range, or only these employees'.
    async fn list_assignments_in_range(&self, tenant_id: &str, employee_ids: Option<Vec<Uuid>>, from_date: NaiveDate, to_date: NaiveDate) -> Result<Vec<EmployeeShiftAssignment>, AppError>;
    /// Deletes `delete_ids`, then inserts `inserts`, in one transaction: a
    /// rotation lands whole or not at all. Returns how many were inserted.
    async fn replace_assignments(&self, tenant_id: &str, delete_ids: Vec<Uuid>, inserts: Vec<EmployeeShiftAssignment>) -> Result<usize, AppError>;
    /// Removes these employees' fixed assignments in the range; returns how many.
    async fn delete_assignments_in_range(&self, tenant_id: &str, employee_ids: Vec<Uuid>, from_date: NaiveDate, to_date: NaiveDate) -> Result<usize, AppError>;
}

/// A named rhythm: one slot per day of the cycle, a shift or None for a day off.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RotationPatternDomain {
    pub id: Uuid,
    pub name: String,
    pub slots: Vec<Option<Uuid>>,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

#[async_trait]
pub trait RotationPatternRepository {
    async fn list_patterns(&self, tenant_id: &str) -> Result<Vec<RotationPatternDomain>, AppError>;
    async fn get_pattern(&self, tenant_id: &str, id: Uuid) -> Result<Option<RotationPatternDomain>, AppError>;
    async fn create_pattern(&self, tenant_id: &str, name: String, slots: Vec<Option<Uuid>>) -> Result<RotationPatternDomain, AppError>;
    async fn update_pattern(&self, tenant_id: &str, id: Uuid, name: String, slots: Vec<Option<Uuid>>) -> Result<RotationPatternDomain, AppError>;
    async fn delete_pattern(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
}

#[async_trait]
pub trait ConfirmedShiftPlanRepository {
    async fn create_confirmed_shift_plan(&self, tenant_id: &str, plan: ConfirmedShiftPlan) -> Result<ConfirmedShiftPlan, AppError>;
    async fn get_confirmed_shift_plans_for_employee(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    async fn get_confirmed_shift_plans_for_employee_in_range(&self, tenant_id: &str, employee_id: Uuid, from_date: NaiveDate, to_date: NaiveDate) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    async fn get_confirmed_shift_plan_by_id(&self, tenant_id: &str, id: Uuid) -> Result<Option<ConfirmedShiftPlan>, AppError>;
    async fn update_confirmed_shift_plan(&self, tenant_id: &str, id: Uuid, shift_id: Option<Option<Uuid>>, workstation_id: Option<Option<Uuid>>, is_present: Option<bool>, absence_type: Option<String>, creation_type: Option<String>) -> Result<ConfirmedShiftPlan, AppError>;
    async fn delete_confirmed_shift_plan(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
    async fn delete_confirmed_shift_plans_for_employee_date_type(&self, tenant_id: &str, employee_id: Uuid, date: NaiveDate, absence_type: &str) -> Result<(), AppError>;
    async fn list_confirmed_shift_plans(&self, tenant_id: &str, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    async fn count_confirmed_shift_plans(&self, tenant_id: &str) -> Result<i64, AppError>;
    async fn get_confirmed_shift_plans_for_date_range(&self, tenant_id: &str, from_date: NaiveDate, to_date: NaiveDate, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    async fn count_confirmed_shift_plans_for_date_range(&self, tenant_id: &str, from_date: NaiveDate, to_date: NaiveDate) -> Result<i64, AppError>;
    /// Atomically replaces all confirmed shift plans for the given employees within
    /// [from_date, to_date]: deletes anything currently there, then inserts `new_plans`
    /// (upserting on the (tenant_id, employee_id, date) unique key). Used by "Take as Plan"
    /// so the whole reassignment happens in one DB transaction instead of many API calls.
    async fn replace_confirmed_shift_plans_for_period(
        &self,
        tenant_id: &str,
        employee_ids: &[Uuid],
        from_date: NaiveDate,
        to_date: NaiveDate,
        new_plans: Vec<ConfirmedShiftPlan>,
    ) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkstationDailyHoursDomain {
    pub date: NaiveDate,
    pub workstation_id: Uuid,
    pub workstation_name: String,
    pub planned_hours: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkstationDailyEmployeesDomain {
    pub date: NaiveDate,
    pub workstation_id: Uuid,
    pub workstation_name: String,
    pub planned_employees: i64,
}

/// Who is working on one day, how many of them, and on which shift.
///
/// Unlike the per-workstation breakdowns above, the count is of *distinct
/// employees* and includes those rostered without a workstation — so it is the
/// answer to "how many people work today", which summing the per-workstation
/// counts is not. Names are resolved here rather than left as ids: the callers
/// that ask this question (the chat agent above all) would otherwise have to
/// join three more lists to say who anyone is.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DailyStaffingDomain {
    pub date: NaiveDate,
    pub employees_working: i64,
    pub employees: Vec<WorkingEmployeeDomain>,
    pub per_shift: Vec<ShiftDailyStaffingDomain>,
}

/// One person working on that day, with everything needed to name them.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkingEmployeeDomain {
    pub employee_id: Uuid,
    pub employee_name: String,
    pub shift_id: Option<Uuid>,
    pub shift_name: Option<String>,
    pub workstation_id: Option<Uuid>,
    pub workstation_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftDailyStaffingDomain {
    pub shift_id: Uuid,
    pub shift_name: String,
    pub employees_working: i64,
}

/// One person's share of the roster over a period — the figures wards argue
/// about. Taken from confirmed plans only: a proposal is not a roster.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct EmployeeFairnessDomain {
    pub employee_id: Uuid,
    pub employee_name: String,
    /// Shifts worked (present, with a shift).
    pub shifts: i64,
    pub hours: f64,
    /// monthly_working_hours scaled to the period (× days / 30), as the solver
    /// reads it; None without a monthly target.
    pub target_hours: Option<f64>,
    /// Shifts that run past midnight.
    pub night_shifts: i64,
    /// Saturdays and Sundays worked.
    pub weekend_days: i64,
    /// Weekends (Saturday–Sunday of one week) with at least one day worked.
    pub weekends: i64,
    pub wishes_asked: i64,
    pub wishes_granted: i64,
    /// Days marked absent — sick, leave, holiday — as opposed to a plain day off.
    pub days_absent: i64,
}

#[async_trait]
pub trait AnalysisRepository {
    async fn get_planned_hours_per_day_per_workstation(&self, tenant_id: &str, from_date: NaiveDate, to_date: NaiveDate) -> Result<Vec<WorkstationDailyHoursDomain>, AppError>;
    async fn get_planned_employees_per_day_per_workstation(&self, tenant_id: &str, from_date: NaiveDate, to_date: NaiveDate) -> Result<Vec<WorkstationDailyEmployeesDomain>, AppError>;
    async fn get_staffing_per_day(&self, tenant_id: &str, from_date: NaiveDate, to_date: NaiveDate) -> Result<Vec<DailyStaffingDomain>, AppError>;
    async fn get_fairness(&self, tenant_id: &str, from_date: NaiveDate, to_date: NaiveDate) -> Result<Vec<EmployeeFairnessDomain>, AppError>;
}

#[async_trait]
pub trait OptimizedShiftResultRepository {
    async fn create_optimized_shift_result(&self, tenant_id: &str, result: serde_json::Value) -> Result<OptimizedShiftResultDomain, AppError>;
    async fn get_optimized_shift_result_by_id(&self, tenant_id: &str, id: Uuid) -> Result<Option<OptimizedShiftResultDomain>, AppError>;
    async fn get_latest_optimized_shift_result(&self, tenant_id: &str) -> Result<Option<OptimizedShiftResultDomain>, AppError>;
    async fn list_optimized_shift_results(&self, tenant_id: &str, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<OptimizedShiftResultDomain>, AppError>;
    async fn count_optimized_shift_results(&self, tenant_id: &str) -> Result<i64, AppError>;
    async fn update_optimized_shift_result(&self, tenant_id: &str, id: Uuid, result: serde_json::Value) -> Result<OptimizedShiftResultDomain, AppError>;
    async fn delete_optimized_shift_result(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlanningTaskDomain {
    pub id: Uuid,
    pub status: String,
    pub payload: serde_json::Value,
    pub result_id: Option<Uuid>,
    pub error_message: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

#[async_trait]
pub trait PlanningTaskRepository {
    async fn create_planning_task(&self, tenant_id: &str, id: Uuid, payload: serde_json::Value) -> Result<PlanningTaskDomain, AppError>;
    async fn get_planning_task(&self, tenant_id: &str, id: Uuid) -> Result<Option<PlanningTaskDomain>, AppError>;
    async fn list_planning_tasks(&self, tenant_id: &str) -> Result<Vec<PlanningTaskDomain>, AppError>;
    async fn update_planning_task_done(&self, tenant_id: &str, id: Uuid, result_id: Uuid) -> Result<(), AppError>;
    async fn update_planning_task_error(&self, tenant_id: &str, id: Uuid, error_message: String) -> Result<(), AppError>;
    async fn delete_planning_task(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError>;
    /// Set result_id = NULL on any task that references the given result, so the task
    /// no longer points to a deleted result.
    async fn clear_task_result_id(&self, tenant_id: &str, result_id: Uuid) -> Result<(), AppError>;
    /// Mark all tasks with status 'scheduled' created before `cutoff` as 'error'.
    /// Not tenant-scoped: startup cleanup runs once across all tenants.
    async fn mark_stale_tasks_failed(&self, cutoff: chrono::NaiveDateTime) -> Result<usize, Box<dyn std::error::Error + Send + Sync>>;
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditLogDomain {
    pub id: Uuid,
    pub actor: Option<String>,
    pub action: String,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub changes: Option<String>,
    pub created_at: chrono::NaiveDateTime,
}

#[async_trait]
pub trait AuditLogRepository {
    async fn create_audit_log(
        &self,
        tenant_id: &str,
        actor: Option<String>,
        action: &str,
        entity_type: Option<&str>,
        entity_id: Option<String>,
        changes: Option<String>,
    ) -> Result<AuditLogDomain, AppError>;
    async fn list_audit_logs(
        &self,
        tenant_id: &str,
        filter: AuditLogFilter,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<AuditLogDomain>, AppError>;
    async fn count_audit_logs(&self, tenant_id: &str, filter: AuditLogFilter) -> Result<i64, AppError>;
    /// The distinct actions, entity types and actors on record — what the
    /// audit log page's filters can offer.
    async fn audit_facets(&self, tenant_id: &str) -> Result<AuditFacetsDomain, AppError>;
}

/// Which audit entries to return. Every set field narrows the result.
#[derive(Debug, Clone, Default)]
pub struct AuditLogFilter {
    pub action: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    /// Case-insensitive part of the actor, e.g. "anna" finds anna.mueller@….
    pub actor: Option<String>,
    pub from_date: Option<chrono::NaiveDateTime>,
    pub to_date: Option<chrono::NaiveDateTime>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AuditFacetsDomain {
    pub actions: Vec<String>,
    pub entity_types: Vec<String>,
    pub actors: Vec<String>,
}

/// Per-tenant configuration for the optimizer (CP-SAT) algorithm.
/// Mirrors `ConstraintConfig` in `planner/shift_planner/models.py`.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlannerSettingsDomain {
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
    /// Keep employees' fixed assignments (rotations) ahead of every other goal,
    /// or plan as if there were none.
    pub keep_fixed_assignments: bool,
    /// Whether employees' max_nights_per_month / max_weekends_per_month are
    /// hard limits or penalised targets. Same two values as min_staffing_mode.
    pub personal_limits_mode: MinStaffingMode,
}

/// Whether `min_employees` (per shift/day and per workstation/shift/day) is a
/// target the solver may miss at a penalty, or a floor it must respect.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MinStaffingMode {
    /// Shortfall is penalised — a plan always exists, it just costs.
    Soft,
    /// Shortfall is forbidden; a period that cannot be staffed comes back infeasible.
    Hard,
}

impl MinStaffingMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            MinStaffingMode::Soft => "soft",
            MinStaffingMode::Hard => "hard",
        }
    }

    /// Parses the stored column value. Anything unexpected — only reachable by
    /// writing to the database directly, the CHECK constraint rules out the
    /// rest — falls back to `Soft` rather than silently making plans infeasible.
    pub fn from_db(value: &str) -> Self {
        match value {
            "hard" => MinStaffingMode::Hard,
            _ => MinStaffingMode::Soft,
        }
    }

    /// Like `from_db`, for a column whose safe fallback is not `Soft`.
    pub fn from_db_or(value: &str, fallback: MinStaffingMode) -> Self {
        match value {
            "hard" => MinStaffingMode::Hard,
            "soft" => MinStaffingMode::Soft,
            _ => fallback,
        }
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct UpdatePlannerSettings {
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

#[async_trait]
pub trait PlannerSettingsRepository {
    /// Returns the tenant's settings, creating a default row on first access.
    async fn get_or_create_planner_settings(&self, tenant_id: &str) -> Result<PlannerSettingsDomain, AppError>;
    async fn update_planner_settings(&self, tenant_id: &str, settings: UpdatePlannerSettings) -> Result<PlannerSettingsDomain, AppError>;
}

/// Whether — and when — employees may place shift wishes themselves.
///
/// The three states an admin can pick on the wish-settings screen. Serialised as
/// `enabled` / `disabled` / `date_range`, which is also how `wish_settings.mode`
/// stores them (see migration 25's CHECK constraint).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WishMode {
    /// Wishes may be placed for any date.
    Enabled,
    /// No self-service wishes at all.
    Disabled,
    /// Wishes may only be placed for dates inside the configured window.
    DateRange,
}

impl WishMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            WishMode::Enabled => "enabled",
            WishMode::Disabled => "disabled",
            WishMode::DateRange => "date_range",
        }
    }

    /// Parses the stored column value. An unknown value — only reachable by writing
    /// to the database directly, the CHECK constraint rules out the rest — is treated
    /// as `Disabled` rather than silently opening the window up.
    pub fn from_db(value: &str) -> Self {
        match value {
            "enabled" => WishMode::Enabled,
            "date_range" => WishMode::DateRange,
            _ => WishMode::Disabled,
        }
    }
}

/// Per-tenant configuration of the self-service shift-wish window.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WishSettingsDomain {
    pub mode: WishMode,
    pub window_start: Option<NaiveDate>,
    pub window_end: Option<NaiveDate>,
    pub updated_at: chrono::NaiveDateTime,
}

impl WishSettingsDomain {
    /// Whether an employee may place or withdraw a wish for `date` themselves.
    ///
    /// A `DateRange` row without both bounds cannot occur (CHECK constraint, plus
    /// validation in the service), and is treated as closed if it somehow does.
    pub fn allows_wish_on(&self, date: NaiveDate) -> bool {
        match self.mode {
            WishMode::Enabled => true,
            WishMode::Disabled => false,
            WishMode::DateRange => match (self.window_start, self.window_end) {
                (Some(start), Some(end)) => date >= start && date <= end,
                _ => false,
            },
        }
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct UpdateWishSettings {
    pub mode: WishMode,
    #[serde(default)]
    pub window_start: Option<NaiveDate>,
    #[serde(default)]
    pub window_end: Option<NaiveDate>,
}

#[async_trait]
pub trait WishSettingsRepository {
    /// Returns the tenant's wish settings, creating an open (`enabled`) row on first
    /// access — the behaviour that predates the window.
    async fn get_or_create_wish_settings(&self, tenant_id: &str) -> Result<WishSettingsDomain, AppError>;
    async fn update_wish_settings(&self, tenant_id: &str, settings: UpdateWishSettings) -> Result<WishSettingsDomain, AppError>;
}

/// One employee's personal limits (`employee_personal_limits`). An employee
/// without a row has none — `PersonalLimitsDomain::none`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PersonalLimitsDomain {
    pub employee_id: Uuid,
    /// Night shifts per calendar month; None = no personal limit.
    pub max_nights_per_month: Option<i16>,
    /// Weekends (Saturday and/or Sunday worked) per calendar month.
    pub max_weekends_per_month: Option<i16>,
    /// Never on a night shift — always hard.
    pub no_night_shifts: bool,
    /// Weekdays they would rather have off, 0 = Monday … 6 = Sunday. Soft.
    pub preferred_days_off: Vec<i16>,
    /// None until the limits are first saved.
    pub updated_at: Option<chrono::NaiveDateTime>,
}

impl PersonalLimitsDomain {
    pub fn none(employee_id: Uuid) -> Self {
        Self {
            employee_id,
            max_nights_per_month: None,
            max_weekends_per_month: None,
            no_night_shifts: false,
            preferred_days_off: Vec::new(),
            updated_at: None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.max_nights_per_month.is_none()
            && self.max_weekends_per_month.is_none()
            && !self.no_night_shifts
            && self.preferred_days_off.is_empty()
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct UpdatePersonalLimits {
    #[serde(default)]
    pub max_nights_per_month: Option<i16>,
    #[serde(default)]
    pub max_weekends_per_month: Option<i16>,
    #[serde(default)]
    pub no_night_shifts: bool,
    #[serde(default)]
    pub preferred_days_off: Vec<i16>,
}

#[async_trait]
pub trait PersonalLimitsRepository {
    async fn list_personal_limits(&self, tenant_id: &str) -> Result<Vec<PersonalLimitsDomain>, AppError>;
    /// The employee's limits, or `PersonalLimitsDomain::none` when none are saved.
    async fn get_personal_limits(&self, tenant_id: &str, employee_id: Uuid) -> Result<PersonalLimitsDomain, AppError>;
    async fn update_personal_limits(&self, tenant_id: &str, employee_id: Uuid, limits: UpdatePersonalLimits) -> Result<PersonalLimitsDomain, AppError>;
}
