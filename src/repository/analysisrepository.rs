use async_trait::async_trait;
use chrono::Datelike;
use chrono::NaiveDate;
use diesel::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::telemetry;
use crate::database::DbPool;
use crate::errors::AppError;
use crate::models as models;
use crate::schema::confirmed_shift_plans;
use crate::schema::employees;
use crate::schema::shift_weekday_times;
use crate::schema::shift_wishes;
use crate::schema::shifts;
use crate::schema::workstations;

use super::domain::{
    AnalysisRepository, DailyStaffingDomain, EmployeeFairnessDomain, ShiftDailyStaffingDomain,
    WorkingEmployeeDomain, WorkstationDailyEmployeesDomain, WorkstationDailyHoursDomain,
};

/// Stored weekdays run 0 = Monday … 6 = Sunday (see shift_weekday_times).
fn weekday_of(date: NaiveDate) -> i16 {
    date.weekday().num_days_from_monday() as i16
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
            let mut result_map: HashMap<(NaiveDate, Uuid), f64> = HashMap::new();
            for plan in &plans {
                if let Some(ws_id) = plan.workstation_id {
                    let hours = plan.shift_id
                        .and_then(|sid| shift_weekday_hours.get(&(sid, weekday_of(plan.date))).copied())
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

            Ok(fairness(&staff, &plans, &times, &wishes, from_date, to_date))
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}

/// Everyone's share of the confirmed roster between two dates, inclusive —
/// including people with nothing at all, since "who got the fewest" is half the
/// question. Sorted by name; the caller sorts by whatever it is comparing.
fn fairness(
    staff: &[models::Employee],
    plans: &[models::ConfirmedShiftPlan],
    times: &[models::ShiftWeekdayTime],
    wishes: &[models::ShiftWish],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Vec<EmployeeFairnessDomain> {
    let days = (to_date - from_date).num_days() + 1;
    let by_day: HashMap<(Uuid, i16), &models::ShiftWeekdayTime> =
        times.iter().map(|t| ((t.shift_id, t.weekday), t)).collect();
    // A shift worked on a day it has no time for (a hand edit) still counts as
    // a night when the shift runs overnight on its other days.
    let overnight_somewhere: std::collections::HashSet<Uuid> =
        times.iter().filter(|t| crosses_midnight(t)).map(|t| t.shift_id).collect();

    let mut rows: HashMap<Uuid, EmployeeFairnessDomain> = staff
        .iter()
        .map(|e| {
            let target = (e.monthly_working_hours > 0.0)
                .then(|| round1(e.monthly_working_hours * days as f64 / 30.0));
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
    let mut weekends: std::collections::HashSet<(Uuid, i32, u32)> = Default::default();
    for plan in plans {
        let Some(row) = rows.get_mut(&plan.employee_id) else { continue };
        if !plan.is_present {
            if plan.absence_type.as_deref() != Some("free") {
                row.days_absent += 1;
            }
            continue;
        }
        let Some(shift_id) = plan.shift_id else { continue };
        let time = by_day.get(&(shift_id, weekday_of(plan.date)));
        row.shifts += 1;
        row.hours += time.map(|t| shift_hours(t)).unwrap_or(0.0);
        let night = match time {
            Some(t) => crosses_midnight(t),
            None => overnight_somewhere.contains(&shift_id),
        };
        if night {
            row.night_shifts += 1;
        }
        if weekday_of(plan.date) >= 5 {
            row.weekend_days += 1;
            let week = plan.date.iso_week();
            weekends.insert((plan.employee_id, week.year(), week.week()));
        }
        worked.insert((plan.employee_id, plan.date, shift_id));
    }
    for (employee_id, _, _) in &weekends {
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

    fn employee(name: &str, monthly: f64) -> models::Employee {
        models::Employee {
            id: Uuid::new_v4(),
            name: name.into(),
            email: format!("{name}@test.invalid"),
            monthly_working_hours: monthly,
            tenant_id: "t".into(),
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
        let staff = [employee("Anna", 150.0), employee("Ben", 0.0)];
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

        let rows = fairness(&staff, &plans, &all_times, &wishes, date("2026-09-01"), date("2026-09-30"));

        let a = rows.iter().find(|r| r.employee_name == "Anna").unwrap();
        assert_eq!(a.shifts, 3);
        assert_eq!(a.hours, 24.0);
        assert_eq!(a.target_hours, Some(150.0));
        assert_eq!(a.night_shifts, 1);
        assert_eq!(a.weekend_days, 2);
        assert_eq!(a.weekends, 1);
        assert_eq!((a.wishes_granted, a.wishes_asked), (1, 2));
        assert_eq!(a.days_absent, 1);

        // Nobody is left out for having nothing.
        let b = rows.iter().find(|r| r.employee_name == "Ben").unwrap();
        assert_eq!((b.shifts, b.hours, b.target_hours), (0, 0.0, None));
    }

    #[test]
    fn hours_are_looked_up_on_the_stored_weekday() {
        // Monday 06–14, Tuesday 06–18: a Monday shift is 8h, not Tuesday's 12h.
        let shift = Uuid::new_v4();
        let mut t = times(shift, (6, 0), (14, 0));
        t[1].end_time = NaiveTime::from_hms_opt(18, 0, 0).unwrap();
        let staff = [employee("Anna", 0.0)];
        let plans = [plan(&staff[0], "2026-09-07", Some(shift), None)];
        let rows = fairness(&staff, &plans, &t, &[], date("2026-09-07"), date("2026-09-07"));
        assert_eq!(rows[0].hours, 8.0);
    }
}
