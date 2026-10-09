use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::errors::AppError;
use crate::services::roster_guard::{RosterChangeCtx, WriteMode};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Employee {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    /// Own contracted hours per week; `None` follows the tenant default
    /// (`planner_settings.default_weekly_working_hours`), `0` means no target.
    pub weekly_working_hours: Option<f64>,
    pub available_shifts: Vec<Shift>,
    pub capabilities: Vec<Capability>,
}

/// The weekly hours an employee is held to: their own value, or the tenant default.
pub fn effective_weekly_hours(own: Option<f64>, default: f64) -> f64 {
    own.unwrap_or(default)
}

/// Weekly hours prorated to a period of `days` days (× days / 7), rounded to
/// 0.1 h; `None` for an employee with no target (0 hours).
pub fn period_target_hours(weekly: f64, days: i64) -> Option<f64> {
    (weekly > 0.0).then(|| (weekly * days as f64 / 7.0 * 10.0).round() / 10.0)
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

/// One side of a shift swap: whose shift, on which day, as it stood in the
/// confirmed roster when the request was made.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct SwapSide {
    pub employee_id: Uuid,
    pub date: NaiveDate,
    pub shift_id: Uuid,
    pub workstation_id: Option<Uuid>,
}

/// Where a swap request stands. Only the two `pending_*` states move on.
pub mod swap_status {
    pub const PENDING_COLLEAGUE: &str = "pending_colleague";
    pub const PENDING_PLANNER: &str = "pending_planner";
    pub const APPROVED: &str = "approved";
    pub const REJECTED: &str = "rejected";
    pub const CANCELLED: &str = "cancelled";
    pub const EXPIRED: &str = "expired";
    pub const STALE: &str = "stale";
    pub const PENDING: [&str; 2] = [PENDING_COLLEAGUE, PENDING_PLANNER];
}

/// A viewer's request to exchange their confirmed shift (`requester`) for a
/// colleague's (`colleague`): the colleague consents, a planner decides.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShiftSwapRequest {
    pub id: Uuid,
    pub requester: SwapSide,
    pub colleague: SwapSide,
    pub status: String,
    pub decided_by: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// What approving a swap came to.
#[derive(Debug)]
pub enum SwapApproval {
    /// The two roster rows were exchanged.
    Approved(ShiftSwapRequest),
    /// The roster no longer matches the request; it is now `stale`. The text says what changed.
    Stale(ShiftSwapRequest, String),
}

impl ConfirmedShiftPlan {
    /// A shift someone is down to work — not an absence or a day off.
    pub fn is_working(&self) -> bool {
        self.is_present && self.shift_id.is_some()
    }

    /// A planned day off ("Take as Plan" writes one for every day without a
    /// shift), as opposed to sick leave, holiday or another absence.
    pub fn is_free(&self) -> bool {
        !self.is_working() && matches!(self.absence_type.as_deref(), None | Some("free"))
    }
}

/// Why the roster no longer allows exchanging `requester` and `colleague`, or
/// `None` when it does. `rows` are the confirmed rows of both people on both
/// dates; anything else is ignored.
///
/// Each side's shift must still be in the roster exactly as requested. When the
/// dates differ, each person must also be free on the other's date: the roster
/// holds one row per person and day, so taking a shift there means giving up
/// whatever was there.
pub fn swap_roster_conflict(
    requester: &SwapSide,
    colleague: &SwapSide,
    rows: &[ConfirmedShiftPlan],
    names: impl Fn(Uuid) -> String,
) -> Option<String> {
    let row = |employee_id: Uuid, date: NaiveDate| {
        rows.iter().find(|r| r.employee_id == employee_id && r.date == date)
    };
    for side in [requester, colleague] {
        let current = row(side.employee_id, side.date);
        let unchanged = current.is_some_and(|r| {
            r.is_working() && r.shift_id == Some(side.shift_id) && r.workstation_id == side.workstation_id
        });
        if !unchanged {
            return Some(format!(
                "{}'s shift on {} has changed or been removed since the request was made",
                names(side.employee_id),
                side.date
            ));
        }
    }
    if requester.date != colleague.date {
        for (who, date) in [(colleague.employee_id, requester.date), (requester.employee_id, colleague.date)] {
            if row(who, date).is_some_and(|r| !r.is_free()) {
                return Some(format!("{} is not free on {date}", names(who)));
            }
        }
    }
    None
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
        async fn create_employee(&self, tenant_id: &str, name: &str, email: &str, weekly_working_hours: Option<f64>) -> Result<Employee, AppError>;
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
pub trait ShiftSwapRepository {
    async fn create_swap(&self, tenant_id: &str, requester: SwapSide, colleague: SwapSide) -> Result<ShiftSwapRequest, AppError>;
    async fn get_swap(&self, tenant_id: &str, id: Uuid) -> Result<Option<ShiftSwapRequest>, AppError>;
    /// Newest first. With `employee_id`, only the requests they are requester or colleague in.
    async fn list_swaps(&self, tenant_id: &str, employee_id: Option<Uuid>, status: Option<String>) -> Result<Vec<ShiftSwapRequest>, AppError>;
    async fn count_swaps_with_status(&self, tenant_id: &str, status: &str) -> Result<i64, AppError>;
    /// Moves the request to `to` if it is in one of `from`; `None` when it is not (or does not exist).
    async fn transition_swap(&self, tenant_id: &str, id: Uuid, from: &[&str], to: &str, decided_by: Option<String>) -> Result<Option<ShiftSwapRequest>, AppError>;
    /// Marks pending requests whose earlier date is before `today` as expired.
    async fn expire_swaps(&self, tenant_id: &str, today: NaiveDate) -> Result<usize, AppError>;
    /// In one transaction: checks the request awaits a planner, compares both
    /// roster rows with the request, and either exchanges them (`Approved`) or
    /// marks the request `stale` (`Stale`). The exchange follows the months'
    /// status (`ctx`) and is tracked as change notices; a refusal leaves the
    /// request awaiting a planner.
    async fn approve_swap(&self, tenant_id: &str, id: Uuid, decided_by: Option<String>, ctx: &RosterChangeCtx) -> Result<SwapApproval, AppError>;
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
    /// Every write takes the caller's `RosterChangeCtx`: it is refused when the
    /// month status forbids it, and tracked as change notices in published and
    /// locked months (see `rostertracking`).
    async fn create_confirmed_shift_plan(&self, tenant_id: &str, plan: ConfirmedShiftPlan, ctx: &RosterChangeCtx) -> Result<ConfirmedShiftPlan, AppError>;
    async fn get_confirmed_shift_plans_for_employee(&self, tenant_id: &str, employee_id: Uuid, published_only: bool) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    async fn get_confirmed_shift_plans_for_employee_in_range(&self, tenant_id: &str, employee_id: Uuid, from_date: NaiveDate, to_date: NaiveDate, published_only: bool) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    async fn get_confirmed_shift_plan_by_id(&self, tenant_id: &str, id: Uuid, published_only: bool) -> Result<Option<ConfirmedShiftPlan>, AppError>;
    #[allow(clippy::too_many_arguments)]
    async fn update_confirmed_shift_plan(&self, tenant_id: &str, id: Uuid, shift_id: Option<Option<Uuid>>, workstation_id: Option<Option<Uuid>>, is_present: Option<bool>, absence_type: Option<String>, creation_type: Option<String>, ctx: &RosterChangeCtx) -> Result<ConfirmedShiftPlan, AppError>;
    async fn delete_confirmed_shift_plan(&self, tenant_id: &str, id: Uuid, ctx: &RosterChangeCtx) -> Result<(), AppError>;
    async fn delete_confirmed_shift_plans_for_employee_date_type(&self, tenant_id: &str, employee_id: Uuid, date: NaiveDate, absence_type: &str, ctx: &RosterChangeCtx) -> Result<(), AppError>;
    /// `published_only`: leave out months that are still draft — what a viewer sees.
    async fn list_confirmed_shift_plans(&self, tenant_id: &str, limit: Option<i64>, offset: Option<i64>, published_only: bool) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    async fn count_confirmed_shift_plans(&self, tenant_id: &str, published_only: bool) -> Result<i64, AppError>;
    async fn get_confirmed_shift_plans_for_date_range(&self, tenant_id: &str, from_date: NaiveDate, to_date: NaiveDate, limit: Option<i64>, offset: Option<i64>, published_only: bool) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    async fn count_confirmed_shift_plans_for_date_range(&self, tenant_id: &str, from_date: NaiveDate, to_date: NaiveDate, published_only: bool) -> Result<i64, AppError>;
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
        ctx: &RosterChangeCtx,
    ) -> Result<Vec<ConfirmedShiftPlan>, AppError>;
    /// What `replace_confirmed_shift_plans_for_period` would change in published
    /// and locked months — the notices it would write — without writing anything.
    async fn count_period_changes(
        &self,
        tenant_id: &str,
        employee_ids: &[Uuid],
        from_date: NaiveDate,
        to_date: NaiveDate,
        new_plans: &[ConfirmedShiftPlan],
        today: NaiveDate,
    ) -> Result<usize, AppError>;
    /// Whether a write to these employee-days would be allowed, without writing.
    async fn check_roster_write(&self, tenant_id: &str, ctx: &RosterChangeCtx, cells: &[(Uuid, NaiveDate)]) -> Result<WriteMode, AppError>;
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
    /// The effective weekly hours prorated to the period (× days / 7), as the
    /// solver reads them; None for someone with no hours target.
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
    /// Weekly hours of every employee without their own value.
    pub default_weekly_working_hours: f64,
    /// Days before a month starts by which it is due to be published.
    pub publish_lead_days: i16,
    /// Days from today in which a change to a published month needs a reason.
    pub freeze_days: i16,
    /// > 0: a re-solve changes as few published employee-days as it must; 0: off.
    pub change_weight: i32,
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
    #[serde(default = "default_weekly_working_hours")]
    pub default_weekly_working_hours: f64,
    #[serde(default = "default_publish_lead_days")]
    pub publish_lead_days: i16,
    #[serde(default = "default_freeze_days")]
    pub freeze_days: i16,
    #[serde(default = "default_change_weight")]
    pub change_weight: i32,
}

fn default_publish_lead_days() -> i16 { 28 }
fn default_freeze_days() -> i16 { 7 }
fn default_change_weight() -> i32 { 100000 }

fn default_weekly_working_hours() -> f64 { 40.0 }
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
    pub schedule: WishScheduleDomain,
    pub updated_at: chrono::NaiveDateTime,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleUnit {
    Days,
    Weeks,
    Months,
}

impl ScheduleUnit {
    pub fn as_str(&self) -> &'static str {
        match self {
            ScheduleUnit::Days => "days",
            ScheduleUnit::Weeks => "weeks",
            ScheduleUnit::Months => "months",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "days" => ScheduleUnit::Days,
            "months" => ScheduleUnit::Months,
            _ => ScheduleUnit::Weeks,
        }
    }
}

/// Recurring rule that opens the wish window and closes it again `open_days` later.
/// All times are UTC.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct WishScheduleDomain {
    pub enabled: bool,
    pub unit: ScheduleUnit,
    /// Every `interval` days / weeks / months.
    pub interval: i32,
    /// 0 = Monday … 6 = Sunday; used by `Weeks`.
    pub weekday: i16,
    /// 1–31, clamped to the month's last day; used by `Months`.
    pub day_of_month: i16,
    pub time: NaiveTime,
    /// How long the window stays open from each occurrence.
    pub open_days: i32,
    /// First occurrence on or after this date; also anchors the interval.
    pub start_date: Option<NaiveDate>,
    /// State the background job last wrote; None until it first applies.
    #[serde(skip)]
    pub applied_open: Option<bool>,
}

impl Default for WishScheduleDomain {
    fn default() -> Self {
        Self {
            enabled: false,
            unit: ScheduleUnit::Weeks,
            interval: 1,
            weekday: 0,
            day_of_month: 1,
            time: NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
            open_days: 7,
            start_date: None,
            applied_open: None,
        }
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1)
        .and_then(|first| first.pred_opt())
        .map_or(28, |last| last.day())
}

impl WishScheduleDomain {
    fn occurs_on(&self, date: NaiveDate) -> bool {
        let Some(start) = self.start_date else { return false };
        if date < start {
            return false;
        }
        let interval = i64::from(self.interval.max(1));
        match self.unit {
            ScheduleUnit::Days => (date - start).num_days() % interval == 0,
            ScheduleUnit::Weeks => {
                let first_monday = start - Duration::days(i64::from(start.weekday().num_days_from_monday()));
                i64::from(date.weekday().num_days_from_monday()) == i64::from(self.weekday)
                    && ((date - first_monday).num_days() / 7) % interval == 0
            }
            ScheduleUnit::Months => {
                let months = i64::from((date.year() - start.year()) * 12 + date.month() as i32 - start.month() as i32);
                let day = u32::try_from(self.day_of_month).unwrap_or(1).min(days_in_month(date.year(), date.month()));
                months % interval == 0 && date.day() == day
            }
        }
    }

    /// Whether the schedule has the window open at `now` (ignores `enabled`).
    pub fn is_open_at(&self, now: NaiveDateTime) -> bool {
        let open_for = Duration::days(i64::from(self.open_days.max(1)));
        (0..=self.open_days.max(1)).any(|back| {
            let date = now.date() - Duration::days(i64::from(back));
            let opens = date.and_time(self.time);
            self.occurs_on(date) && opens <= now && now < opens + open_for
        })
    }

    /// The next moment after `now` the window flips, and whether it then opens.
    pub fn next_change(&self, now: NaiveDateTime) -> Option<(NaiveDateTime, bool)> {
        let open_for = Duration::days(i64::from(self.open_days.max(1)));
        let current = self.is_open_at(now);
        let first = now.date() - open_for;
        let mut best: Option<NaiveDateTime> = None;
        for offset in 0..=(800 + self.open_days.max(1)) {
            let date = first + Duration::days(i64::from(offset));
            if !self.occurs_on(date) {
                continue;
            }
            let opens = date.and_time(self.time);
            for candidate in [opens, opens + open_for] {
                if candidate > now && self.is_open_at(candidate) != current && best.map_or(true, |b| candidate < b) {
                    best = Some(candidate);
                }
            }
        }
        best.map(|at| (at, !current))
    }
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
    /// Replaces the recurring schedule; the mode and window are untouched.
    async fn update_wish_schedule(&self, tenant_id: &str, schedule: WishScheduleDomain) -> Result<WishSettingsDomain, AppError>;
    /// Every tenant whose schedule is switched on.
    async fn list_scheduled_wish_settings(&self) -> Result<Vec<(String, WishSettingsDomain)>, AppError>;
    /// Sets the mode to open/closed, unless the job already applied that state.
    /// Returns whether it changed anything, so concurrent replicas apply once.
    async fn apply_scheduled_wish_state(&self, tenant_id: &str, open: bool) -> Result<bool, AppError>;
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

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct HolidayDomain {
    pub date: NaiveDate,
    pub name: String,
    pub state: String,
}

#[async_trait]
pub trait HolidayRepository {
    async fn list_holidays(&self, tenant_id: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<HolidayDomain>, AppError>;
    /// How many holidays are stored in the range for this state.
    async fn count_holidays(&self, tenant_id: &str, from: NaiveDate, to: NaiveDate, state: &str) -> Result<i64, AppError>;
    /// Replaces everything stored in `from..=to` with `holidays`.
    async fn replace_holidays(&self, tenant_id: &str, from: NaiveDate, to: NaiveDate, holidays: Vec<HolidayDomain>) -> Result<(), AppError>;
}

// ---------------------------------------------------------------------------
// Roster lifecycle: month status and change notices
// ---------------------------------------------------------------------------

/// The status of one calendar month of a tenant's confirmed roster.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MonthStatus {
    /// Being planned; planners only, edits are not tracked.
    Draft,
    /// Visible to everyone; every change is tracked as a notice.
    Published,
    /// Over (or locked by an admin); only an admin with a reason may change it.
    Locked,
}

impl MonthStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            MonthStatus::Draft => "draft",
            MonthStatus::Published => "published",
            MonthStatus::Locked => "locked",
        }
    }

    /// The stored column value; the CHECK constraint rules out anything else,
    /// and an unknown value is treated as the least visible status.
    pub fn from_db(value: &str) -> Self {
        match value {
            "published" => MonthStatus::Published,
            "locked" => MonthStatus::Locked,
            _ => MonthStatus::Draft,
        }
    }
}

/// The first day of the month `date` falls in.
pub fn month_start(date: NaiveDate) -> NaiveDate {
    date.with_day(1).expect("day 1 exists in every month")
}

/// The last day of the month starting at (or containing) `month`.
pub fn month_end(month: NaiveDate) -> NaiveDate {
    let first = month_start(month);
    let next = if first.month() == 12 {
        NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)
    }
    .expect("valid next month");
    next - Duration::days(1)
}

/// Every month start from the month of `from` to the month of `to`, inclusive.
pub fn months_between(from: NaiveDate, to: NaiveDate) -> Vec<NaiveDate> {
    let mut months = Vec::new();
    let mut m = month_start(from);
    let last = month_start(to);
    while m <= last {
        months.push(m);
        m = month_end(m) + Duration::days(1);
    }
    months
}

/// A month's stored status row. No row means the month was never touched: draft.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RosterMonth {
    pub month: NaiveDate,
    pub status: MonthStatus,
    pub published_at: Option<NaiveDateTime>,
    pub published_by: Option<String>,
    pub locked_at: Option<NaiveDateTime>,
    pub locked_by: Option<String>,
    /// Unlocked by an admin: stays published after its last day.
    pub reopened: bool,
    pub updated_at: NaiveDateTime,
}

impl RosterMonth {
    /// The status as everyone sees it on `today`: a published month whose last
    /// day has passed reads as locked, unless an admin reopened it.
    pub fn effective_status(&self, today: NaiveDate) -> MonthStatus {
        effective_status(Some(self), self.month, today)
    }
}

/// The effective status of `month` given its stored row (if any) on `today`.
pub fn effective_status(row: Option<&RosterMonth>, month: NaiveDate, today: NaiveDate) -> MonthStatus {
    match row.map(|r| (r.status, r.reopened)) {
        None | Some((MonthStatus::Draft, _)) => MonthStatus::Draft,
        Some((MonthStatus::Locked, _)) => MonthStatus::Locked,
        Some((MonthStatus::Published, true)) => MonthStatus::Published,
        Some((MonthStatus::Published, false)) if month_end(month) < today => MonthStatus::Locked,
        Some((MonthStatus::Published, false)) => MonthStatus::Published,
    }
}

/// What a month status change writes. `None` fields are left as they are.
#[derive(Debug, Clone)]
pub struct RosterMonthTransition {
    pub month: NaiveDate,
    /// Effective statuses the month must be in, or the change is refused.
    pub from: Vec<MonthStatus>,
    pub to: MonthStatus,
    pub actor: Option<String>,
    pub reopened: bool,
}

/// One employee's confirmed entry on one day, as a notice shows it.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct RosterEntry {
    pub shift_id: Option<Uuid>,
    pub workstation_id: Option<Uuid>,
    pub absence_type: Option<String>,
}

/// Where a roster change came from.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeSource {
    Manual,
    TakeAsPlan,
    Absence,
    Swap,
    Replacement,
}

impl ChangeSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChangeSource::Manual => "manual",
            ChangeSource::TakeAsPlan => "take_as_plan",
            ChangeSource::Absence => "absence",
            ChangeSource::Swap => "swap",
            ChangeSource::Replacement => "replacement",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "take_as_plan" => ChangeSource::TakeAsPlan,
            "absence" => ChangeSource::Absence,
            "swap" => ChangeSource::Swap,
            "replacement" => ChangeSource::Replacement,
            _ => ChangeSource::Manual,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RosterChangeNotice {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub date: NaiveDate,
    /// The entry before the change; `None` when there was none.
    pub before: Option<RosterEntry>,
    /// The entry after the change; `None` when it was removed.
    pub after: Option<RosterEntry>,
    pub source: ChangeSource,
    pub actor: Option<String>,
    pub reason: Option<String>,
    pub created_at: NaiveDateTime,
    pub acknowledged_at: Option<NaiveDateTime>,
}

#[derive(Debug, Clone, Default)]
pub struct NoticeFilter {
    pub employee_id: Option<Uuid>,
    pub from_date: Option<NaiveDate>,
    pub to_date: Option<NaiveDate>,
    pub acknowledged: Option<bool>,
}

#[async_trait]
pub trait RosterMonthRepository {
    /// The stored rows for months from `from` to `to` (month starts, inclusive).
    async fn list_roster_months(&self, tenant_id: &str, from: NaiveDate, to: NaiveDate) -> Result<Vec<RosterMonth>, AppError>;
    /// Moves a month to `to` if its effective status on `today` is one of
    /// `from`; `None` when it is not. Creates the row on first use.
    async fn transition_roster_month(&self, tenant_id: &str, change: RosterMonthTransition, today: NaiveDate) -> Result<Option<RosterMonth>, AppError>;
}

#[async_trait]
pub trait RosterChangeNoticeRepository {
    /// Newest first.
    async fn list_notices(&self, tenant_id: &str, filter: NoticeFilter) -> Result<Vec<RosterChangeNotice>, AppError>;
    async fn count_unacknowledged(&self, tenant_id: &str, employee_id: Uuid) -> Result<i64, AppError>;
    /// Acknowledges `ids` (all unacknowledged ones when `None`) of `employee_id`.
    /// Refused (`Forbidden`) when any of `ids` is about someone else.
    async fn acknowledge_notices(&self, tenant_id: &str, employee_id: Uuid, ids: Option<Vec<Uuid>>) -> Result<usize, AppError>;
}

#[cfg(test)]
mod roster_month_tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn row(month: NaiveDate, status: MonthStatus, reopened: bool) -> RosterMonth {
        RosterMonth {
            month,
            status,
            published_at: None,
            published_by: None,
            locked_at: None,
            locked_by: None,
            reopened,
            updated_at: NaiveDateTime::default(),
        }
    }

    #[test]
    fn an_untouched_month_is_draft() {
        assert_eq!(effective_status(None, d(2026, 11, 1), d(2026, 10, 9)), MonthStatus::Draft);
    }

    #[test]
    fn a_published_month_locks_itself_once_its_last_day_has_passed() {
        let oct = row(d(2026, 10, 1), MonthStatus::Published, false);
        assert_eq!(oct.effective_status(d(2026, 10, 31)), MonthStatus::Published, "still its last day");
        assert_eq!(oct.effective_status(d(2026, 11, 1)), MonthStatus::Locked);
    }

    #[test]
    fn a_draft_month_never_locks_itself() {
        let sep = row(d(2026, 9, 1), MonthStatus::Draft, false);
        assert_eq!(sep.effective_status(d(2027, 1, 1)), MonthStatus::Draft);
    }

    #[test]
    fn a_month_an_admin_unlocked_stays_published() {
        let sep = row(d(2026, 9, 1), MonthStatus::Published, true);
        assert_eq!(sep.effective_status(d(2026, 12, 1)), MonthStatus::Published);
    }

    #[test]
    fn a_locked_month_stays_locked() {
        let nov = row(d(2026, 11, 1), MonthStatus::Locked, false);
        assert_eq!(nov.effective_status(d(2026, 10, 9)), MonthStatus::Locked, "an admin may lock early");
    }

    #[test]
    fn month_arithmetic_handles_year_ends_and_leap_years() {
        assert_eq!(month_end(d(2026, 12, 15)), d(2026, 12, 31));
        assert_eq!(month_end(d(2028, 2, 1)), d(2028, 2, 29));
        assert_eq!(months_between(d(2026, 11, 20), d(2027, 1, 3)), vec![d(2026, 11, 1), d(2026, 12, 1), d(2027, 1, 1)]);
    }
}
