use async_trait::async_trait;
use chrono::Datelike;
use chrono::NaiveDate;
use diesel::prelude::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use uuid::Uuid;

use crate::telemetry;
use crate::database::DbPool;
use crate::errors::AppError;
use crate::models as models;
use crate::schema::confirmed_shift_plans;
use crate::schema::employees;
use crate::schema::planner_settings;
use crate::schema::shift_weekday_times;
use crate::schema::shift_wishes;
use crate::schema::shifts;
use crate::schema::workstations;

use super::domain::{
    effective_weekly_hours, period_target_hours,
    AnalysisRepository, AnalyticsCapabilityDomain, AuditActivityGroupDomain, ChangeFactDomain, PlanningRunDomain, RosterEntry, AnalyticsClosureDomain, AnalyticsEmployeeDomain,
    AnalyticsMonthDomain, AnalyticsShiftDomain, AnalyticsWeekdayRuleDomain, AnalyticsWorkstationDomain,
    DailyStaffingDomain, EmployeeFairnessDomain, RosterFactDimsDomain, RosterFactRowsDomain,
    RosterFactsDomain, ShiftDailyStaffingDomain, WorkingEmployeeDomain, WorkstationDailyEmployeesDomain,
    WorkstationDailyHoursDomain,
};

/// Stored weekdays run 0 = Monday … 6 = Sunday (see shift_weekday_times).
/// A public holiday is a Sunday: it uses the shift's Sunday times.
fn weekday_of(date: NaiveDate, holidays: &HashSet<NaiveDate>) -> i16 {
    if holidays.contains(&date) {
        return 6;
    }
    date.weekday().num_days_from_monday() as i16
}

/// The Saturday of the weekend a day belongs to, or None on an ordinary
/// weekday. A holiday joins the nearest weekend (Mon–Wed the one before,
/// Thu–Fri the one after), as in the planner.
fn weekend_saturday(date: NaiveDate, holidays: &HashSet<NaiveDate>) -> Option<NaiveDate> {
    let wd = date.weekday().num_days_from_monday() as i64;
    if wd >= 5 {
        return Some(date - chrono::Duration::days(wd - 5));
    }
    if holidays.contains(&date) {
        return Some(if wd <= 2 { date - chrono::Duration::days(wd + 2) } else { date + chrono::Duration::days(5 - wd) });
    }
    None
}

fn load_holidays(
    conn: &mut PgConnection,
    tenant_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<HashSet<NaiveDate>, AppError> {
    use crate::schema::public_holidays;
    public_holidays::table
        .filter(public_holidays::tenant_id.eq(tenant_id))
        .filter(public_holidays::holiday_date.between(from, to))
        .select(public_holidays::holiday_date)
        .load::<NaiveDate>(conn)
        .map(|v| v.into_iter().collect())
        .map_err(|_| AppError::Internal)
}

/// Hours of one weekday time. An end at or before the start runs past midnight
/// into the next day; equal times are refused by the API, so none are 0h.
fn shift_hours(swt: &models::ShiftWeekdayTime) -> f64 {
    let minutes = (swt.end_time - swt.start_time).num_minutes();
    let minutes = if minutes <= 0 { minutes + 24 * 60 } else { minutes };
    minutes as f64 / 60.0
}

fn crosses_midnight(swt: &models::ShiftWeekdayTime) -> bool {
    swt.end_time <= swt.start_time
}

/// How one worked entry counts: its hours, whether it is a night, and the
/// weekend it falls in.
pub(crate) struct EntryCount {
    pub hours: f64,
    pub night: bool,
    pub weekend_saturday: Option<NaiveDate>,
}

/// Counts worked entries the one way the fairness report and the analytics
/// roster facts both use, so the two cannot disagree.
pub(crate) struct ShiftClock<'a> {
    by_day: HashMap<(Uuid, i16), &'a models::ShiftWeekdayTime>,
    overnight_somewhere: HashSet<Uuid>,
    holidays: &'a HashSet<NaiveDate>,
}

impl<'a> ShiftClock<'a> {
    pub fn new(times: &'a [models::ShiftWeekdayTime], holidays: &'a HashSet<NaiveDate>) -> Self {
        ShiftClock {
            by_day: times.iter().map(|t| ((t.shift_id, t.weekday), t)).collect(),
            // A shift worked on a day it has no time for (a hand edit) still
            // counts as a night when the shift runs overnight on its other days.
            overnight_somewhere: times.iter().filter(|t| crosses_midnight(t)).map(|t| t.shift_id).collect(),
            holidays,
        }
    }

    pub fn count(&self, date: NaiveDate, shift_id: Uuid) -> EntryCount {
        let time = self.by_day.get(&(shift_id, weekday_of(date, self.holidays)));
        EntryCount {
            hours: time.map(|t| shift_hours(t)).unwrap_or(0.0),
            night: match time {
                Some(t) => crosses_midnight(t),
                None => self.overnight_somewhere.contains(&shift_id),
            },
            weekend_saturday: weekend_saturday(date, self.holidays),
        }
    }
}

#[derive(Clone)]
pub struct DieselAnalysisRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl AnalysisRepository for DieselAnalysisRepository {
    async fn get_planned_hours_per_day_per_workstation(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<WorkstationDailyHoursDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;

            // Fetch confirmed shift plans in range where employee is present and workstation is assigned
            let plans: Vec<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                .filter(confirmed_shift_plans::is_present.eq(true))
                .filter(confirmed_shift_plans::workstation_id.is_not_null())
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            if plans.is_empty() {
                return Ok(Vec::new());
            }

            // Collect unique shift IDs and workstation IDs
            let shift_ids: Vec<Uuid> = plans.iter().filter_map(|p| p.shift_id).collect::<std::collections::HashSet<_>>().into_iter().collect();
            let workstation_ids: Vec<Uuid> = plans.iter().filter_map(|p| p.workstation_id).collect::<std::collections::HashSet<_>>().into_iter().collect();

            // Fetch shift weekday times for the relevant shifts
            let weekday_times: Vec<models::ShiftWeekdayTime> = shift_weekday_times::table
                .filter(shift_weekday_times::shift_id.eq_any(&shift_ids))
                .filter(shift_weekday_times::tenant_id.eq(&tenant_id))
                .load::<models::ShiftWeekdayTime>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            // (shift_id, weekday) -> duration in hours; overnight shifts included
            let shift_weekday_hours: HashMap<(Uuid, i16), f64> = weekday_times
                .iter()
                .map(|swt| ((swt.shift_id, swt.weekday), shift_hours(swt)))
                .collect();

            // Fetch workstation names
            let ws_list: Vec<models::Workstation> = workstations::table
                .filter(workstations::id.eq_any(&workstation_ids))
                .filter(workstations::tenant_id.eq(&tenant_id))
                .load::<models::Workstation>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            let ws_names: HashMap<Uuid, String> = ws_list.into_iter().map(|w| (w.id, w.name)).collect();

            // Aggregate: (date, workstation_id) -> total planned hours
            let holidays = load_holidays(&mut conn, &tenant_id, from_date, to_date)?;
            let mut result_map: HashMap<(NaiveDate, Uuid), f64> = HashMap::new();
            for plan in &plans {
                if let Some(ws_id) = plan.workstation_id {
                    let hours = plan.shift_id
                        .and_then(|sid| shift_weekday_hours.get(&(sid, weekday_of(plan.date, &holidays))).copied())
                        .unwrap_or(0.0);
                    *result_map.entry((plan.date, ws_id)).or_insert(0.0) += hours;
                }
            }

            // Convert to sorted vec
            let mut results: Vec<WorkstationDailyHoursDomain> = result_map
                .into_iter()
                .map(|((date, ws_id), planned_hours)| WorkstationDailyHoursDomain {
                    date,
                    workstation_id: ws_id,
                    workstation_name: ws_names.get(&ws_id).cloned().unwrap_or_default(),
                    planned_hours,
                })
                .collect();

            results.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.workstation_name.cmp(&b.workstation_name)));

            Ok(results)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_planned_employees_per_day_per_workstation(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<WorkstationDailyEmployeesDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;

            // Fetch confirmed shift plans in range where employee is present and workstation is assigned
            let plans: Vec<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                .filter(confirmed_shift_plans::is_present.eq(true))
                .filter(confirmed_shift_plans::workstation_id.is_not_null())
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            if plans.is_empty() {
                return Ok(Vec::new());
            }

            // Collect unique workstation IDs
            let workstation_ids: Vec<Uuid> = plans.iter().filter_map(|p| p.workstation_id).collect::<std::collections::HashSet<_>>().into_iter().collect();

            // Fetch workstation names
            let ws_list: Vec<models::Workstation> = workstations::table
                .filter(workstations::id.eq_any(&workstation_ids))
                .filter(workstations::tenant_id.eq(&tenant_id))
                .load::<models::Workstation>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            let ws_names: HashMap<Uuid, String> = ws_list.into_iter().map(|w| (w.id, w.name)).collect();

            // Aggregate: (date, workstation_id) -> count of employees
            let mut result_map: HashMap<(NaiveDate, Uuid), i64> = HashMap::new();
            for plan in &plans {
                if let Some(ws_id) = plan.workstation_id {
                    *result_map.entry((plan.date, ws_id)).or_insert(0) += 1;
                }
            }

            // Convert to sorted vec
            let mut results: Vec<WorkstationDailyEmployeesDomain> = result_map
                .into_iter()
                .map(|((date, ws_id), planned_employees)| WorkstationDailyEmployeesDomain {
                    date,
                    workstation_id: ws_id,
                    workstation_name: ws_names.get(&ws_id).cloned().unwrap_or_default(),
                    planned_employees,
                })
                .collect();

            results.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.workstation_name.cmp(&b.workstation_name)));

            Ok(results)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_staffing_per_day(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<DailyStaffingDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;

            // Everyone marked present, workstation or not — a nurse rostered
            // without one is still working. Absences (is_present false) are the
            // rest of the roster and are excluded.
            let plans: Vec<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                .filter(confirmed_shift_plans::is_present.eq(true))
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            if plans.is_empty() {
                return Ok(Vec::new());
            }

            let shift_ids: Vec<Uuid> = plans
                .iter()
                .filter_map(|p| p.shift_id)
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            let workstation_ids: Vec<Uuid> = plans
                .iter()
                .filter_map(|p| p.workstation_id)
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            let employee_ids: Vec<Uuid> = plans
                .iter()
                .map(|p| p.employee_id)
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();

            let shift_names: HashMap<Uuid, String> = shifts::table
                .filter(shifts::id.eq_any(&shift_ids))
                .filter(shifts::tenant_id.eq(&tenant_id))
                .load::<models::Shift>(&mut conn)
                .map_err(|_| AppError::Internal)?
                .into_iter()
                .map(|s| (s.id, s.name))
                .collect();

            let workstation_names: HashMap<Uuid, String> = workstations::table
                .filter(workstations::id.eq_any(&workstation_ids))
                .filter(workstations::tenant_id.eq(&tenant_id))
                .load::<models::Workstation>(&mut conn)
                .map_err(|_| AppError::Internal)?
                .into_iter()
                .map(|w| (w.id, w.name))
                .collect();

            let employee_names: HashMap<Uuid, String> = employees::table
                .filter(employees::id.eq_any(&employee_ids))
                .filter(employees::tenant_id.eq(&tenant_id))
                .load::<models::Employee>(&mut conn)
                .map_err(|_| AppError::Internal)?
                .into_iter()
                .map(|e| (e.id, e.name))
                .collect();

            // Distinct employees, because one person can hold two entries on a
            // day (two workstations, or a split shift) and is still one person.
            let mut per_day: HashMap<NaiveDate, Vec<WorkingEmployeeDomain>> = HashMap::new();
            let mut per_day_employees: HashMap<NaiveDate, std::collections::HashSet<Uuid>> =
                HashMap::new();
            let mut per_day_shift: HashMap<(NaiveDate, Uuid), std::collections::HashSet<Uuid>> =
                HashMap::new();
            for plan in &plans {
                per_day_employees
                    .entry(plan.date)
                    .or_default()
                    .insert(plan.employee_id);
                per_day.entry(plan.date).or_default().push(WorkingEmployeeDomain {
                    employee_id: plan.employee_id,
                    employee_name: employee_names
                        .get(&plan.employee_id)
                        .cloned()
                        .unwrap_or_default(),
                    shift_id: plan.shift_id,
                    shift_name: plan.shift_id.and_then(|id| shift_names.get(&id).cloned()),
                    workstation_id: plan.workstation_id,
                    workstation_name: plan
                        .workstation_id
                        .and_then(|id| workstation_names.get(&id).cloned()),
                });
                if let Some(shift_id) = plan.shift_id {
                    per_day_shift
                        .entry((plan.date, shift_id))
                        .or_default()
                        .insert(plan.employee_id);
                }
            }

            let mut results: Vec<DailyStaffingDomain> = per_day
                .into_iter()
                .map(|(date, mut employees)| {
                    let mut per_shift: Vec<ShiftDailyStaffingDomain> = per_day_shift
                        .iter()
                        .filter(|((d, _), _)| *d == date)
                        .map(|((_, shift_id), shift_employees)| ShiftDailyStaffingDomain {
                            shift_id: *shift_id,
                            shift_name: shift_names.get(shift_id).cloned().unwrap_or_default(),
                            employees_working: shift_employees.len() as i64,
                        })
                        .collect();
                    per_shift.sort_by(|a, b| a.shift_name.cmp(&b.shift_name));
                    employees.sort_by(|a, b| {
                        a.shift_name
                            .cmp(&b.shift_name)
                            .then_with(|| a.employee_name.cmp(&b.employee_name))
                    });

                    DailyStaffingDomain {
                        date,
                        employees_working: per_day_employees
                            .get(&date)
                            .map(|set| set.len())
                            .unwrap_or(0) as i64,
                        employees,
                        per_shift,
                    }
                })
                .collect();

            results.sort_by_key(|r| r.date);

            Ok(results)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_fairness(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<EmployeeFairnessDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;

            let staff: Vec<models::Employee> = employees::table
                .filter(employees::tenant_id.eq(&tenant_id))
                .load(&mut conn)
                .map_err(|_| AppError::Internal)?;
            let plans: Vec<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .load(&mut conn)
                .map_err(|_| AppError::Internal)?;
            let times: Vec<models::ShiftWeekdayTime> = shift_weekday_times::table
                .filter(shift_weekday_times::tenant_id.eq(&tenant_id))
                .load(&mut conn)
                .map_err(|_| AppError::Internal)?;
            let wishes: Vec<models::ShiftWish> = shift_wishes::table
                .filter(shift_wishes::tenant_id.eq(&tenant_id))
                .filter(shift_wishes::wish_date.ge(from_date))
                .filter(shift_wishes::wish_date.le(to_date))
                .load(&mut conn)
                .map_err(|_| AppError::Internal)?;

            let holidays = load_holidays(&mut conn, &tenant_id, from_date, to_date)?;
            // No settings row yet means the shipped default.
            let default_weekly: f64 = planner_settings::table
                .filter(planner_settings::tenant_id.eq(&tenant_id))
                .select(planner_settings::default_weekly_working_hours)
                .first(&mut conn)
                .optional()
                .map_err(|_| AppError::Internal)?
                .unwrap_or(models::NewPlannerSettings::defaults(&tenant_id).default_weekly_working_hours);

            Ok(fairness(&staff, default_weekly, &plans, &times, &wishes, &holidays, from_date, to_date))
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_roster_facts(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<RosterFactsDomain, AppError> {
        use crate::schema::{capabilities, employee_capabilities, roster_months, workstation_unavailabilities};
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;
            let internal = |_| AppError::Internal;

            // Only the columns the report may show — never e-mail, never
            // anything from personal limits.
            let staff: Vec<(Uuid, String, Option<f64>)> = employees::table
                .filter(employees::tenant_id.eq(&tenant_id))
                .select((employees::id, employees::name, employees::weekly_working_hours))
                .load(&mut conn)
                .map_err(internal)?;
            let held: Vec<(Uuid, Uuid)> = employee_capabilities::table
                .filter(employee_capabilities::tenant_id.eq(&tenant_id))
                .select((employee_capabilities::employee_id, employee_capabilities::capability_id))
                .load(&mut conn)
                .map_err(internal)?;
            let caps: Vec<(Uuid, String)> = capabilities::table
                .filter(capabilities::tenant_id.eq(&tenant_id))
                .select((capabilities::id, capabilities::name))
                .load(&mut conn)
                .map_err(internal)?;
            let shift_list: Vec<models::Shift> = shifts::table
                .filter(shifts::tenant_id.eq(&tenant_id))
                .load(&mut conn)
                .map_err(internal)?;
            let times: Vec<models::ShiftWeekdayTime> = shift_weekday_times::table
                .filter(shift_weekday_times::tenant_id.eq(&tenant_id))
                .load(&mut conn)
                .map_err(internal)?;
            let stations: Vec<models::Workstation> = workstations::table
                .filter(workstations::tenant_id.eq(&tenant_id))
                .load(&mut conn)
                .map_err(internal)?;
            let closures: Vec<models::WorkstationUnavailability> = workstation_unavailabilities::table
                .filter(workstation_unavailabilities::tenant_id.eq(&tenant_id))
                .filter(workstation_unavailabilities::unavailable_from.le(to_date))
                .filter(workstation_unavailabilities::unavailable_to.ge(from_date))
                .load(&mut conn)
                .map_err(internal)?;
            let statuses: Vec<(NaiveDate, String)> = roster_months::table
                .filter(roster_months::tenant_id.eq(&tenant_id))
                .filter(roster_months::month.le(to_date))
                .select((roster_months::month, roster_months::status))
                .load(&mut conn)
                .map_err(internal)?;
            let plans: Vec<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .order((confirmed_shift_plans::date, confirmed_shift_plans::employee_id))
                .load(&mut conn)
                .map_err(internal)?;
            let holidays = load_holidays(&mut conn, &tenant_id, from_date, to_date)?;
            let default_weekly: f64 = planner_settings::table
                .filter(planner_settings::tenant_id.eq(&tenant_id))
                .select(planner_settings::default_weekly_working_hours)
                .first(&mut conn)
                .optional()
                .map_err(internal)?
                .unwrap_or(models::NewPlannerSettings::defaults(&tenant_id).default_weekly_working_hours);

            Ok(roster_facts(RosterFactInput {
                staff: &staff,
                held: &held,
                capabilities: &caps,
                shifts: &shift_list,
                times: &times,
                workstations: &stations,
                closures: &closures,
                statuses: &statuses,
                plans: &plans,
                holidays: &holidays,
                default_weekly,
                from_date,
                to_date,
            }))
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_change_facts(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<ChangeFactDomain>, AppError> {
        use crate::schema::roster_change_notices;
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;
            let (start, end) = day_bounds(from_date, to_date);
            let notices: Vec<models::RosterChangeNotice> = roster_change_notices::table
                .filter(roster_change_notices::tenant_id.eq(&tenant_id))
                .filter(roster_change_notices::created_at.ge(start))
                .filter(roster_change_notices::created_at.lt(end))
                .order(roster_change_notices::created_at)
                .load(&mut conn)
                .map_err(|_| AppError::Internal)?;
            let employee_names: HashMap<Uuid, String> = employees::table
                .filter(employees::tenant_id.eq(&tenant_id))
                .select((employees::id, employees::name))
                .load::<(Uuid, String)>(&mut conn)
                .map_err(|_| AppError::Internal)?
                .into_iter()
                .collect();
            let workstation_names: HashMap<Uuid, String> = workstations::table
                .filter(workstations::tenant_id.eq(&tenant_id))
                .select((workstations::id, workstations::name))
                .load::<(Uuid, String)>(&mut conn)
                .map_err(|_| AppError::Internal)?
                .into_iter()
                .collect();
            Ok(change_facts(notices, &employee_names, &workstation_names))
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_audit_activity(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<AuditActivityGroupDomain>, AppError> {
        use diesel::sql_types::{Date, Text};
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;
            // The log is unbounded, so it is counted here rather than shipped.
            // Days are UTC, the clock `GET /audit-logs` filters on.
            diesel::sql_query(
                "SELECT (created_at AT TIME ZONE 'UTC')::date AS day, action, entity_type, actor, count(*) AS count \
                 FROM audit_logs \
                 WHERE tenant_id = $1 \
                   AND (created_at AT TIME ZONE 'UTC')::date BETWEEN $2 AND $3 \
                 GROUP BY 1, 2, 3, 4 \
                 ORDER BY 1, 2, 3, 4",
            )
            .bind::<Text, _>(&tenant_id)
            .bind::<Date, _>(from_date)
            .bind::<Date, _>(to_date)
            .load::<AuditActivityGroupDomain>(&mut conn)
            .map_err(|_| AppError::Internal)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_planning_runs(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<PlanningRunDomain>, AppError> {
        use diesel::sql_types::{Text, Timestamp};
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;
            let (start, end) = day_bounds(from_date, to_date);
            // Only the result's head-line fields are read — never the plan.
            // The automatic outcome is the latest `planner.auto_result` entry
            // for the task, which auto_plan.rs writes as JSON.
            diesel::sql_query(
                "SELECT t.id, \
                        t.created_at AT TIME ZONE 'UTC' AS created_at, \
                        CASE WHEN t.status IN ('done', 'error') THEN t.updated_at AT TIME ZONE 'UTC' END AS finished_at, \
                        t.source, t.status, t.error_message, t.result_id, \
                        (r.result #>> '{planning_period,start_date}')::date AS period_start, \
                        (r.result #>> '{planning_period,end_date}')::date AS period_end, \
                        r.result ->> 'status' AS solver_status, \
                        coalesce(r.result ->> 'message', '') <> '' AS has_message, \
                        CASE WHEN t.source = 'auto' THEN \
                            (SELECT (a.changes::jsonb ->> 'outcome') = 'taken_over' \
                               FROM audit_logs a \
                              WHERE a.tenant_id = t.tenant_id \
                                AND a.action = 'planner.auto_result' \
                                AND a.entity_id = t.id::text \
                              ORDER BY a.created_at DESC \
                              LIMIT 1) \
                        END AS taken_as_roster \
                   FROM planning_tasks t \
                   LEFT JOIN optimized_shift_results r ON r.id = t.result_id AND r.tenant_id = t.tenant_id \
                  WHERE t.tenant_id = $1 \
                    AND t.created_at >= $2 AT TIME ZONE 'UTC' \
                    AND t.created_at < $3 AT TIME ZONE 'UTC' \
                  ORDER BY t.created_at",
            )
            .bind::<Text, _>(&tenant_id)
            .bind::<Timestamp, _>(start)
            .bind::<Timestamp, _>(end)
            .load::<PlanningRunDomain>(&mut conn)
            .map_err(|_| AppError::Internal)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}

/// Day bounds of an inclusive date range, for filtering timestamps.
fn day_bounds(from_date: NaiveDate, to_date: NaiveDate) -> (chrono::NaiveDateTime, chrono::NaiveDateTime) {
    (
        from_date.and_hms_opt(0, 0, 0).expect("midnight"),
        (to_date + chrono::Duration::days(1)).and_hms_opt(0, 0, 0).expect("midnight"),
    )
}

/// Notices as change facts. The before/after snapshots are `RosterEntry`
/// JSON; a missing side (a new or a deleted entry) reads as all-null.
fn change_facts(
    notices: Vec<models::RosterChangeNotice>,
    employee_names: &HashMap<Uuid, String>,
    workstation_names: &HashMap<Uuid, String>,
) -> Vec<ChangeFactDomain> {
    let entry = |v: &Option<serde_json::Value>| -> RosterEntry {
        v.clone()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or(RosterEntry { shift_id: None, workstation_id: None, absence_type: None })
    };
    notices
        .into_iter()
        .map(|n| {
            let (before, after) = (entry(&n.before), entry(&n.after));
            let name = |id: Option<Uuid>| id.and_then(|id| workstation_names.get(&id).cloned());
            ChangeFactDomain {
                id: n.id,
                created_at: n.created_at,
                date: n.date,
                employee_id: n.employee_id,
                employee_name: employee_names.get(&n.employee_id).cloned().unwrap_or_default(),
                workstation_before: before.workstation_id,
                workstation_after: after.workstation_id,
                workstation_before_name: name(before.workstation_id),
                workstation_after_name: name(after.workstation_id),
                shift_before: before.shift_id,
                shift_after: after.shift_id,
                absence_before: before.absence_type,
                absence_after: after.absence_type,
                source: n.source,
                actor: n.actor,
                reason: n.reason,
                acknowledged_at: n.acknowledged_at,
            }
        })
        .collect()
}

/// Everything `roster_facts` reads, loaded by `get_roster_facts`.
struct RosterFactInput<'a> {
    staff: &'a [(Uuid, String, Option<f64>)],
    held: &'a [(Uuid, Uuid)],
    capabilities: &'a [(Uuid, String)],
    shifts: &'a [models::Shift],
    times: &'a [models::ShiftWeekdayTime],
    workstations: &'a [models::Workstation],
    closures: &'a [models::WorkstationUnavailability],
    statuses: &'a [(NaiveDate, String)],
    plans: &'a [models::ConfirmedShiftPlan],
    holidays: &'a HashSet<NaiveDate>,
    default_weekly: f64,
    from_date: NaiveDate,
    to_date: NaiveDate,
}

/// The confirmed roster of a period as columns plus the dimensions the
/// analytics report needs to read them. Hours, nights and weekends come from
/// the same `ShiftClock` the fairness report counts with.
fn roster_facts(input: RosterFactInput) -> RosterFactsDomain {
    let RosterFactInput { staff, held, capabilities, shifts: shift_list, times, workstations: stations, closures, statuses, plans, holidays, default_weekly, from_date, to_date } = input;

    let mut employees_dim: Vec<AnalyticsEmployeeDomain> = staff
        .iter()
        .map(|(id, name, weekly)| AnalyticsEmployeeDomain {
            id: *id,
            name: name.clone(),
            capabilities: Vec::new(),
            weekly_hours: effective_weekly_hours(*weekly, default_weekly),
        })
        .collect();
    employees_dim.sort_by(|a, b| a.name.cmp(&b.name));
    let employee_index: HashMap<Uuid, usize> = employees_dim.iter().enumerate().map(|(i, e)| (e.id, i)).collect();
    for (employee_id, capability_id) in held {
        if let Some(&i) = employee_index.get(employee_id) {
            employees_dim[i].capabilities.push(*capability_id);
        }
    }

    let mut capabilities_dim: Vec<AnalyticsCapabilityDomain> = capabilities
        .iter()
        .map(|(id, name)| AnalyticsCapabilityDomain { id: *id, name: name.clone() })
        .collect();
    capabilities_dim.sort_by(|a, b| a.name.cmp(&b.name));

    let mut ordered_shifts: Vec<&models::Shift> = shift_list.iter().collect();
    ordered_shifts.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.cmp(&b.name)));
    let shifts_dim: Vec<AnalyticsShiftDomain> = ordered_shifts
        .iter()
        .map(|s| {
            let mut weekday: Vec<AnalyticsWeekdayRuleDomain> = times
                .iter()
                .filter(|t| t.shift_id == s.id)
                .map(|t| AnalyticsWeekdayRuleDomain { weekday: t.weekday, min: t.min_employees, max: t.max_employees })
                .collect();
            weekday.sort_by_key(|r| r.weekday);
            AnalyticsShiftDomain {
                id: s.id,
                name: s.name.clone(),
                short_name: s.short_name.clone(),
                color: s.color.clone(),
                is_night: times.iter().any(|t| t.shift_id == s.id && crosses_midnight(t)),
                weekday,
            }
        })
        .collect();
    let shift_index: HashMap<Uuid, usize> = shifts_dim.iter().enumerate().map(|(i, s)| (s.id, i)).collect();

    let mut ordered_stations: Vec<&models::Workstation> = stations.iter().collect();
    ordered_stations.sort_by(|a, b| a.name.cmp(&b.name));
    let workstations_dim: Vec<AnalyticsWorkstationDomain> = ordered_stations
        .iter()
        .map(|w| {
            let mut own: Vec<AnalyticsClosureDomain> = closures
                .iter()
                .filter(|c| c.workstation_id == w.id)
                .map(|c| AnalyticsClosureDomain { from: c.unavailable_from, to: c.unavailable_to })
                .collect();
            own.sort_by_key(|c| c.from);
            AnalyticsWorkstationDomain {
                id: w.id,
                name: w.name.clone(),
                available: w.available,
                active_shift_ids: w.active_shift_ids.clone(),
                min: w.min_employees,
                max: w.max_employees,
                closures: own,
            }
        })
        .collect();
    let workstation_index: HashMap<Uuid, usize> = workstations_dim.iter().enumerate().map(|(i, w)| (w.id, i)).collect();

    // Every month the period touches; no stored row means draft.
    let stored: HashMap<NaiveDate, &str> = statuses.iter().map(|(m, s)| (*m, s.as_str())).collect();
    let mut months = Vec::new();
    let mut month = from_date.with_day(1).expect("first of month");
    while month <= to_date {
        months.push(AnalyticsMonthDomain {
            month,
            status: stored.get(&month).copied().unwrap_or("draft").to_string(),
        });
        month = month.checked_add_months(chrono::Months::new(1)).expect("next month");
    }

    let mut holiday_list: Vec<NaiveDate> = holidays.iter().copied().collect();
    holiday_list.sort();

    let clock = ShiftClock::new(times, holidays);
    let mut rows = RosterFactRowsDomain::default();
    for plan in plans {
        let Some(&employee) = employee_index.get(&plan.employee_id) else { continue };
        let worked = plan.is_present.then_some(plan.shift_id).flatten().map(|shift_id| clock.count(plan.date, shift_id));
        rows.date.push(plan.date);
        rows.employee.push(employee);
        rows.shift.push(plan.shift_id.and_then(|id| shift_index.get(&id).copied()));
        rows.workstation.push(plan.workstation_id.and_then(|id| workstation_index.get(&id).copied()));
        rows.present.push(plan.is_present);
        rows.absence.push(plan.absence_type.clone());
        rows.creation.push(plan.creation_type.clone());
        // Unrounded: the fairness report rounds the sum, not each entry.
        rows.hours.push(worked.as_ref().map(|c| c.hours).unwrap_or(0.0));
        rows.night.push(worked.as_ref().map(|c| c.night).unwrap_or(false));
        rows.weekend.push(weekend_saturday(plan.date, holidays));
        rows.holiday.push(holidays.contains(&plan.date));
    }

    RosterFactsDomain {
        from_date,
        to_date,
        dims: RosterFactDimsDomain {
            employees: employees_dim,
            capabilities: capabilities_dim,
            shifts: shifts_dim,
            workstations: workstations_dim,
            months,
            holidays: holiday_list,
        },
        rows,
    }
}

/// Everyone's share of the confirmed roster between two dates, inclusive —
/// including people with nothing at all, since "who got the fewest" is half the
/// question. Sorted by name; the caller sorts by whatever it is comparing.
fn fairness(
    staff: &[models::Employee],
    default_weekly: f64,
    plans: &[models::ConfirmedShiftPlan],
    times: &[models::ShiftWeekdayTime],
    wishes: &[models::ShiftWish],
    holidays: &HashSet<NaiveDate>,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Vec<EmployeeFairnessDomain> {
    let days = (to_date - from_date).num_days() + 1;
    let clock = ShiftClock::new(times, holidays);

    let mut rows: HashMap<Uuid, EmployeeFairnessDomain> = staff
        .iter()
        .map(|e| {
            let target = period_target_hours(effective_weekly_hours(e.weekly_working_hours, default_weekly), days);
            (e.id, EmployeeFairnessDomain {
                employee_id: e.id,
                employee_name: e.name.clone(),
                shifts: 0,
                hours: 0.0,
                target_hours: target,
                night_shifts: 0,
                weekend_days: 0,
                weekends: 0,
                wishes_asked: 0,
                wishes_granted: 0,
                days_absent: 0,
            })
        })
        .collect();

    let mut worked: std::collections::HashSet<(Uuid, NaiveDate, Uuid)> = Default::default();
    let mut weekends: std::collections::HashSet<(Uuid, NaiveDate)> = Default::default();
    for plan in plans {
        let Some(row) = rows.get_mut(&plan.employee_id) else { continue };
        if !plan.is_present {
            if plan.absence_type.as_deref() != Some("free") {
                row.days_absent += 1;
            }
            continue;
        }
        let Some(shift_id) = plan.shift_id else { continue };
        let count = clock.count(plan.date, shift_id);
        row.shifts += 1;
        row.hours += count.hours;
        if count.night {
            row.night_shifts += 1;
        }
        if let Some(saturday) = count.weekend_saturday {
            row.weekend_days += 1;
            weekends.insert((plan.employee_id, saturday));
        }
        worked.insert((plan.employee_id, plan.date, shift_id));
    }
    for (employee_id, _) in &weekends {
        if let Some(row) = rows.get_mut(employee_id) {
            row.weekends += 1;
        }
    }
    for wish in wishes {
        let Some(row) = rows.get_mut(&wish.employee_id) else { continue };
        row.wishes_asked += 1;
        if worked.contains(&(wish.employee_id, wish.wish_date, wish.shift_id)) {
            row.wishes_granted += 1;
        }
    }

    let mut rows: Vec<EmployeeFairnessDomain> = rows
        .into_values()
        .map(|mut r| {
            r.hours = round1(r.hours);
            r
        })
        .collect();
    rows.sort_by(|a, b| a.employee_name.cmp(&b.employee_name));
    rows
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDateTime, NaiveTime};

    fn date(d: &str) -> NaiveDate {
        NaiveDate::parse_from_str(d, "%Y-%m-%d").unwrap()
    }

    fn employee(name: &str, weekly: Option<f64>) -> models::Employee {
        models::Employee {
            id: Uuid::new_v4(),
            name: name.into(),
            email: format!("{name}@test.invalid"),
            tenant_id: "t".into(),
            weekly_working_hours: weekly,
        }
    }

    fn times(shift_id: Uuid, start: (u32, u32), end: (u32, u32)) -> Vec<models::ShiftWeekdayTime> {
        (0..7)
            .map(|weekday| models::ShiftWeekdayTime {
                id: Uuid::new_v4(),
                shift_id,
                weekday,
                start_time: NaiveTime::from_hms_opt(start.0, start.1, 0).unwrap(),
                end_time: NaiveTime::from_hms_opt(end.0, end.1, 0).unwrap(),
                min_employees: 1,
                max_employees: None,
                free_days_after_shift: 0,
                tenant_id: "t".into(),
            })
            .collect()
    }

    fn plan(employee: &models::Employee, day: &str, shift: Option<Uuid>, absence: Option<&str>) -> models::ConfirmedShiftPlan {
        let now = NaiveDateTime::default();
        models::ConfirmedShiftPlan {
            id: Uuid::new_v4(),
            employee_id: employee.id,
            shift_id: shift,
            workstation_id: None,
            date: date(day),
            is_present: absence.is_none(),
            absence_type: absence.map(str::to_string),
            creation_type: "manual".into(),
            created_at: now,
            updated_at: now,
            tenant_id: "t".into(),
        }
    }

    #[test]
    fn counts_hours_nights_weekends_wishes_and_absences_per_person() {
        let (early, night) = (Uuid::new_v4(), Uuid::new_v4());
        let mut all_times = times(early, (6, 0), (14, 0));
        all_times.extend(times(night, (22, 0), (6, 0)));
        // Anna 35 h a week, Ben no target, Carla the tenant default.
        let staff = [employee("Anna", Some(35.0)), employee("Ben", Some(0.0)), employee("Carla", None)];
        let anna = &staff[0];
        let plans = vec![
            plan(anna, "2026-09-11", Some(early), None), // Friday
            plan(anna, "2026-09-12", Some(night), None), // Saturday, night
            plan(anna, "2026-09-13", Some(early), None), // Sunday, same weekend
            plan(anna, "2026-09-14", None, Some("sick")),
            plan(anna, "2026-09-15", None, Some("free")), // a day off is not an absence
        ];
        let wishes = vec![
            models::ShiftWish { id: Uuid::new_v4(), employee_id: anna.id, shift_id: night, wish_date: date("2026-09-12"), tenant_id: "t".into(), created_at: NaiveDateTime::default() },
            models::ShiftWish { id: Uuid::new_v4(), employee_id: anna.id, shift_id: early, wish_date: date("2026-09-16"), tenant_id: "t".into(), created_at: NaiveDateTime::default() },
        ];

        let rows = fairness(&staff, 40.0, &plans, &all_times, &wishes, &HashSet::new(), date("2026-09-01"), date("2026-09-30"));

        let a = rows.iter().find(|r| r.employee_name == "Anna").unwrap();
        assert_eq!(a.shifts, 3);
        assert_eq!(a.hours, 24.0);
        assert_eq!(a.target_hours, Some(150.0), "35 h × 30 days / 7");
        assert_eq!(a.night_shifts, 1);
        assert_eq!(a.weekend_days, 2);
        assert_eq!(a.weekends, 1);
        assert_eq!((a.wishes_granted, a.wishes_asked), (1, 2));
        assert_eq!(a.days_absent, 1);

        // Nobody is left out for having nothing.
        let b = rows.iter().find(|r| r.employee_name == "Ben").unwrap();
        assert_eq!((b.shifts, b.hours, b.target_hours), (0, 0.0, None));
        let c = rows.iter().find(|r| r.employee_name == "Carla").unwrap();
        assert_eq!(c.target_hours, Some(171.4), "the default, 40 h × 30 days / 7");
    }

    fn facts_for(
        staff: &[models::Employee],
        all_times: &[models::ShiftWeekdayTime],
        plans: &[models::ConfirmedShiftPlan],
        holidays: &HashSet<NaiveDate>,
        from: &str,
        to: &str,
    ) -> RosterFactsDomain {
        let staff_rows: Vec<(Uuid, String, Option<f64>)> =
            staff.iter().map(|e| (e.id, e.name.clone(), e.weekly_working_hours)).collect();
        let shift_ids: HashSet<Uuid> = all_times.iter().map(|t| t.shift_id).collect();
        let shift_list: Vec<models::Shift> = shift_ids
            .into_iter()
            .map(|id| models::Shift {
                id,
                name: id.to_string(),
                short_name: "S".into(),
                color: "#000".into(),
                order: 0,
                tenant_id: "t".into(),
                break_minutes: 30,
            })
            .collect();
        roster_facts(RosterFactInput {
            staff: &staff_rows,
            held: &[],
            capabilities: &[],
            shifts: &shift_list,
            times: all_times,
            workstations: &[],
            closures: &[],
            statuses: &[(date("2026-09-01"), "published".into())],
            plans,
            holidays,
            default_weekly: 40.0,
            from_date: date(from),
            to_date: date(to),
        })
    }

    #[test]
    fn roster_facts_count_like_the_fairness_report() {
        let (early, night) = (Uuid::new_v4(), Uuid::new_v4());
        let mut all_times = times(early, (6, 0), (13, 20));
        all_times.extend(times(night, (22, 0), (6, 0)));
        let staff = [employee("Anna", Some(35.0)), employee("Ben", None)];
        let anna = &staff[0];
        let holidays: HashSet<NaiveDate> = [date("2026-09-16")].into_iter().collect(); // a Wednesday
        let plans = vec![
            plan(anna, "2026-09-11", Some(early), None),
            plan(anna, "2026-09-12", Some(night), None),
            plan(anna, "2026-09-13", Some(early), None),
            plan(anna, "2026-09-14", None, Some("sick")),
            plan(anna, "2026-09-16", Some(night), None), // night on a holiday
        ];

        let facts = facts_for(&staff, &all_times, &plans, &holidays, "2026-09-01", "2026-09-30");
        let fair = fairness(&staff, 40.0, &plans, &all_times, &[], &holidays, date("2026-09-01"), date("2026-09-30"));
        let a = fair.iter().find(|r| r.employee_name == "Anna").unwrap();

        let rows = &facts.rows;
        let anna_idx = facts.dims.employees.iter().position(|e| e.id == anna.id).unwrap();
        let mine: Vec<usize> = (0..rows.date.len()).filter(|&i| rows.employee[i] == anna_idx).collect();
        let hours: f64 = mine.iter().map(|&i| rows.hours[i]).sum();
        assert_eq!(round1(hours), a.hours, "summed row hours equal the fairness hours");
        assert_eq!(mine.iter().filter(|&&i| rows.night[i]).count() as i64, a.night_shifts);
        let weekend_days = mine.iter().filter(|&&i| rows.present[i] && rows.shift[i].is_some() && rows.weekend[i].is_some()).count();
        assert_eq!(weekend_days as i64, a.weekend_days, "the holiday joins a weekend, as in fairness");

        // Night on a holiday: both flags.
        let holiday_row = mine.iter().copied().find(|&i| rows.date[i] == date("2026-09-16")).unwrap();
        assert!(rows.night[holiday_row] && rows.holiday[holiday_row]);
        assert_eq!(rows.hours[holiday_row], 8.0);

        // Sick: absent, typed, no hours, no night.
        let sick = mine.iter().copied().find(|&i| rows.date[i] == date("2026-09-14")).unwrap();
        assert!(!rows.present[sick]);
        assert_eq!(rows.absence[sick].as_deref(), Some("sick"));
        assert_eq!((rows.hours[sick], rows.night[sick]), (0.0, false));

        // Ben follows the tenant default; the month row and the holiday are listed.
        let ben = facts.dims.employees.iter().find(|e| e.name == "Ben").unwrap();
        assert_eq!(ben.weekly_hours, 40.0);
        assert_eq!(facts.dims.months, vec![AnalyticsMonthDomain { month: date("2026-09-01"), status: "published".into() }]);
        assert_eq!(facts.dims.holidays, vec![date("2026-09-16")]);
    }

    #[test]
    fn roster_facts_list_staffing_rules_per_weekday_and_untracked_months_as_draft() {
        let shift = Uuid::new_v4();
        let mut t = times(shift, (6, 0), (14, 0));
        t[5].min_employees = 2; // Saturday
        t[6].min_employees = 3; // Sunday — what a holiday uses
        let facts = facts_for(&[], &t, &[], &HashSet::new(), "2026-08-20", "2026-10-02");

        let rules = &facts.dims.shifts[0].weekday;
        assert_eq!(rules.iter().find(|r| r.weekday == 5).unwrap().min, 2);
        assert_eq!(rules.iter().find(|r| r.weekday == 6).unwrap().min, 3);
        let statuses: Vec<(NaiveDate, &str)> = facts.dims.months.iter().map(|m| (m.month, m.status.as_str())).collect();
        assert_eq!(
            statuses,
            vec![(date("2026-08-01"), "draft"), (date("2026-09-01"), "published"), (date("2026-10-01"), "draft")],
        );
    }

    /// The Analytics page sums roster facts in the browser and must arrive at
    /// the Fairness report's numbers. This pins both halves in one file the UI
    /// spec reads too (`model/hours.spec.ts`): the facts this repository sends
    /// for a scenario, and the fairness rows it computes for the same plans.
    /// `UPDATE_FIXTURES=1 cargo test` rewrites it after a deliberate change.
    #[test]
    fn hours_fixture_matches_what_the_backend_sends_and_counts() {
        let id = |n: u128| Uuid::from_u128(n);
        let (early, night) = (id(101), id(102));
        let mut all_times = times(early, (6, 0), (13, 20));
        all_times.extend(times(night, (22, 0), (6, 0)));
        for t in all_times.iter_mut() {
            t.id = id(1000 + t.weekday as u128 + if t.shift_id == night { 10 } else { 0 });
        }
        let mut staff = [employee("Anna", Some(35.0)), employee("Ben", None), employee("Carla", Some(0.0))];
        for (n, e) in staff.iter_mut().enumerate() {
            e.id = id(1 + n as u128);
        }
        let holidays: HashSet<NaiveDate> = [date("2026-09-16")].into_iter().collect();
        let (anna, ben) = (&staff[0], &staff[1]);
        let plans = vec![
            plan(anna, "2026-09-11", Some(early), None),
            plan(anna, "2026-09-12", Some(night), None),
            plan(anna, "2026-09-13", Some(early), None),
            plan(anna, "2026-09-14", None, Some("sick")),
            plan(anna, "2026-09-16", Some(night), None),
            plan(anna, "2026-09-19", Some(early), None),
            plan(ben, "2026-09-12", Some(early), None),
            plan(ben, "2026-09-16", Some(early), None),
            plan(ben, "2026-09-26", Some(night), None),
            plan(ben, "2026-09-27", Some(night), None),
            plan(ben, "2026-09-28", None, Some("vacation")),
        ];
        let (from, to) = ("2026-09-01", "2026-09-30");
        let mut facts = facts_for(&staff, &all_times, &plans, &holidays, from, to);
        facts.dims.shifts.sort_by_key(|s| s.id);
        let index: HashMap<Uuid, usize> = facts.dims.shifts.iter().enumerate().map(|(i, s)| (s.id, i)).collect();
        facts.rows.shift = plans.iter().map(|p| p.shift_id.map(|s| index[&s])).collect();
        let fair = fairness(&staff, 40.0, &plans, &all_times, &[], &holidays, date(from), date(to));

        let actual = serde_json::json!({
            "_about": "Written by analysisrepository.rs (hours_fixture_matches_what_the_backend_sends_and_counts); read by model/hours.spec.ts. Do not edit by hand.",
            "facts": facts,
            "fairness": fair.iter().map(|r| serde_json::json!({
                "employee_id": r.employee_id,
                "shifts": r.shifts,
                "hours": r.hours,
                "target_hours": r.target_hours,
                "night_shifts": r.night_shifts,
                "weekend_days": r.weekend_days,
                "weekends": r.weekends,
            })).collect::<Vec<_>>(),
        });
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("ui/src/app/pages/reports/analytics/model/hours.fixture.json");
        if std::env::var_os("UPDATE_FIXTURES").is_some() {
            std::fs::write(&path, serde_json::to_string_pretty(&actual).unwrap() + "\n").unwrap();
        }
        let stored: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("fixture")).unwrap();
        assert_eq!(stored, actual, "hours.fixture.json is stale — rerun with UPDATE_FIXTURES=1");
    }

    #[test]
    fn analytics_employee_carries_only_the_allowed_fields() {
        let facts = facts_for(&[employee("Anna", Some(30.0))], &[], &[], &HashSet::new(), "2026-09-01", "2026-09-01");
        let value = serde_json::to_value(&facts.dims.employees[0]).unwrap();
        let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, vec!["capabilities", "id", "name", "weekly_hours"]);
    }

    #[test]
    fn hours_are_looked_up_on_the_stored_weekday() {
        // Monday 06–14, Tuesday 06–18: a Monday shift is 8h, not Tuesday's 12h.
        let shift = Uuid::new_v4();
        let mut t = times(shift, (6, 0), (14, 0));
        t[1].end_time = NaiveTime::from_hms_opt(18, 0, 0).unwrap();
        let staff = [employee("Anna", Some(0.0))];
        let plans = [plan(&staff[0], "2026-09-07", Some(shift), None)];
        let rows = fairness(&staff, 40.0, &plans, &t, &[], &HashSet::new(), date("2026-09-07"), date("2026-09-07"));
        assert_eq!(rows[0].hours, 8.0);
    }
}
