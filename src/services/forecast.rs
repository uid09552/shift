//! Capacity forecast: for the coming months, the hours the staff can work —
//! contracted hours minus recorded absences (approved leave, sick days) — set
//! against the hours the workstations need (their minimum staffing per shift,
//! or their demand curve), in total and per capability. A month whose need
//! exceeds what is available shows a gap before anyone plans it.

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{Datelike, Months, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::domain::{
    effective_weekly_hours, CapabilityRepository, EmployeeRepository, PlannerSettingsRepository, ShiftRepository,
    UnavailabilityRepository, WorkstationRepository, WorkstationUnavailabilityRepository,
};
use crate::repository::AppState;
use crate::services::tenant::{RoleContext, TenantContext};

#[derive(Deserialize)]
pub struct ForecastQuery {
    /// First month, YYYY-MM (default: this month).
    pub from: Option<String>,
    /// How many months (1–12, default 6).
    pub months: Option<u32>,
}

/// One employee as the forecast needs them.
pub struct Person {
    pub weekly_hours: f64,
    pub capabilities: Vec<Uuid>,
    /// Whole days they are recorded absent (hard unavailability).
    pub absent: HashSet<NaiveDate>,
}

/// One workstation as the forecast needs it.
pub struct Station {
    pub id: Uuid,
    pub name: String,
    pub capabilities: Vec<Uuid>,
    /// Hours needed on a day: weekday (0 = Monday, holidays 6) -> person-hours.
    pub hours_by_weekday: [f64; 7],
    pub closed: Vec<(NaiveDate, NaiveDate)>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct CapabilityLine {
    pub id: Uuid,
    pub name: String,
    pub required_hours: f64,
    pub available_hours: f64,
    pub gap_hours: f64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct MonthForecast {
    pub month: String,
    pub days: i64,
    pub contracted_hours: f64,
    pub absence_hours: f64,
    pub available_hours: f64,
    pub required_hours: f64,
    /// required − available: > 0 is a shortfall.
    pub gap_hours: f64,
    pub workstations: Vec<Value>,
    pub capabilities: Vec<CapabilityLine>,
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn weekday(day: NaiveDate, holidays: &HashSet<NaiveDate>) -> usize {
    if holidays.contains(&day) { 6 } else { day.weekday().num_days_from_monday() as usize }
}

/// The forecast itself — pure, so it is tested without a database.
pub fn forecast(
    first_months: &[NaiveDate],
    people: &[Person],
    stations: &[Station],
    capability_names: &HashMap<Uuid, String>,
    holidays: &HashSet<NaiveDate>,
) -> Vec<MonthForecast> {
    first_months
        .iter()
        .map(|&first| {
            let last = first + Months::new(1) - chrono::Duration::days(1);
            let days: Vec<NaiveDate> = first.iter_days().take_while(|d| *d <= last).collect();
            let n = days.len() as f64;

            let mut contracted = 0.0;
            let mut absence = 0.0;
            let mut available_by_cap: HashMap<Uuid, f64> = HashMap::new();
            for p in people {
                let own = p.weekly_hours * n / 7.0;
                // An absent working day costs a fifth of the week; weekends nothing.
                let away = days
                    .iter()
                    .filter(|d| p.absent.contains(d) && d.weekday().num_days_from_monday() < 5)
                    .count() as f64
                    * p.weekly_hours
                    / 5.0;
                let away = away.min(own);
                contracted += own;
                absence += away;
                for c in &p.capabilities {
                    *available_by_cap.entry(*c).or_default() += own - away;
                }
            }

            let mut required = 0.0;
            let mut required_by_cap: HashMap<Uuid, f64> = HashMap::new();
            let mut by_station = Vec::new();
            for s in stations {
                let hours: f64 = days
                    .iter()
                    .filter(|d| !s.closed.iter().any(|(from, to)| from <= *d && *d <= to))
                    .map(|d| s.hours_by_weekday[weekday(*d, holidays)])
                    .sum();
                required += hours;
                for c in &s.capabilities {
                    *required_by_cap.entry(*c).or_default() += hours;
                }
                by_station.push(json!({"id": s.id, "name": s.name, "required_hours": round1(hours)}));
            }

            let mut capabilities: Vec<CapabilityLine> = required_by_cap
                .iter()
                .map(|(id, need)| {
                    let have = available_by_cap.get(id).copied().unwrap_or(0.0);
                    CapabilityLine {
                        id: *id,
                        name: capability_names.get(id).cloned().unwrap_or_default(),
                        required_hours: round1(*need),
                        available_hours: round1(have),
                        gap_hours: round1(need - have),
                    }
                })
                .collect();
            capabilities.sort_by(|a, b| b.gap_hours.total_cmp(&a.gap_hours).then(a.name.cmp(&b.name)));

            let available = contracted - absence;
            MonthForecast {
                month: format!("{:04}-{:02}", first.year(), first.month()),
                days: days.len() as i64,
                contracted_hours: round1(contracted),
                absence_hours: round1(absence),
                available_hours: round1(available),
                required_hours: round1(required),
                gap_hours: round1(required - available),
                workstations: by_station,
                capabilities,
            }
        })
        .collect()
}

fn span_hours(start: NaiveTime, end: NaiveTime, break_minutes: i16) -> f64 {
    let minutes = (end - start).num_minutes();
    let minutes = if minutes <= 0 { minutes + 24 * 60 } else { minutes };
    ((minutes - break_minutes as i64).max(0)) as f64 / 60.0
}

pub struct ForecastService;

impl ForecastService {
    /// GET /analysis/capacity-forecast?from=YYYY-MM&months=6 (planners and admins).
    pub async fn get(
        tenant: TenantContext,
        roles: RoleContext,
        Query(q): Query<ForecastQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        if !roles.can_write() {
            return Err(AppError::Forbidden("The capacity forecast is for planners and admins".into()));
        }
        let months = q.months.unwrap_or(6);
        if !(1..=12).contains(&months) {
            return Err(AppError::Validation("months must be between 1 and 12".into()));
        }
        let today = crate::services::roster_guard::today();
        let first = match q.from.as_deref() {
            Some(m) => NaiveDate::parse_from_str(&format!("{m}-01"), "%Y-%m-%d")
                .map_err(|_| AppError::Validation("from must be YYYY-MM".into()))?,
            None => today.with_day(1).ok_or(AppError::Internal)?,
        };
        let firsts: Vec<NaiveDate> = (0..months).map(|i| first + Months::new(i)).collect();
        let last = *firsts.last().ok_or(AppError::Internal)? + Months::new(1) - chrono::Duration::days(1);
        let t = &tenant.0;

        let default_weekly = state.planner_settings_repo.get_or_create_planner_settings(t).await?.default_weekly_working_hours;
        let mut absent: HashMap<Uuid, HashSet<NaiveDate>> = HashMap::new();
        for u in state.unavailability_repo.list_unavailabilities(t).await? {
            if !u.is_soft_preference && u.shift_id.is_none() && u.unavailable_date >= first && u.unavailable_date <= last {
                absent.entry(u.employee_id).or_default().insert(u.unavailable_date);
            }
        }
        let people: Vec<Person> = state
            .employee_repo
            .list_employees(t, None, None)
            .await?
            .into_iter()
            .map(|e| Person {
                weekly_hours: effective_weekly_hours(e.weekly_working_hours, default_weekly),
                // A capability that has lapsed by the first month no longer counts.
                capabilities: e.capabilities.iter().filter(|c| c.valid_on(first)).map(|c| c.id).collect(),
                absent: absent.remove(&e.id).unwrap_or_default(),
            })
            .collect();

        let shifts = state.shift_repo.list_shifts(t).await?;
        let demand = crate::services::demand::curves_for_tenant(&state, t).await?;
        let mut closures: HashMap<Uuid, Vec<(NaiveDate, NaiveDate)>> = HashMap::new();
        for c in state.workstation_unavailability_repo.list_workstation_unavailabilities(t).await? {
            closures.entry(c.workstation_id).or_default().push((c.unavailable_from, c.unavailable_to));
        }
        let stations: Vec<Station> = state
            .workstation_repo
            .list_workstations(t)
            .await?
            .into_iter()
            .filter(|w| w.available && !w.active_shift_ids.is_empty())
            .map(|w| {
                let mut per_day = [0.0; 7];
                let curves: HashMap<i16, f64> = demand
                    .get(&w.id)
                    .map(|days| days.iter().map(|(wd, hours)| (*wd, hours.iter().map(|h| *h as f64).sum())).collect())
                    .unwrap_or_default();
                for (wd, slot) in per_day.iter_mut().enumerate() {
                    if let Some(hours) = curves.get(&(wd as i16)) {
                        *slot = *hours;
                        continue;
                    }
                    *slot = shifts
                        .iter()
                        .filter(|s| w.active_shift_ids.contains(&s.id) && s.duty_type != "on_call")
                        .filter_map(|s| s.weekday_times.iter().find(|t| t.weekday == wd as i16).map(|t| (s, t)))
                        .map(|(s, t)| w.min_employees as f64 * span_hours(t.start_time, t.end_time, s.break_minutes))
                        .sum();
                }
                Station {
                    id: w.id,
                    name: w.name,
                    capabilities: w.required_capabilities.iter().map(|c| c.id).collect(),
                    hours_by_weekday: per_day,
                    closed: closures.remove(&w.id).unwrap_or_default(),
                }
            })
            .collect();
        let names: HashMap<Uuid, String> =
            state.capability_repo.list_capabilities(t).await?.into_iter().map(|c| (c.id, c.name)).collect();
        let holidays: HashSet<NaiveDate> =
            crate::services::holiday::dates_in_range(&state, t, first, last).await?.into_iter().collect();

        Ok(Json(json!({
            "from": format!("{:04}-{:02}", first.year(), first.month()),
            "months": forecast(&firsts, &people, &stations, &names, &holidays),
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn available_hours_are_contract_minus_absence_set_against_the_stations_needs() {
        let icu = Uuid::new_v4();
        let people = vec![
            Person { weekly_hours: 35.0, capabilities: vec![icu], absent: [d("2026-09-01"), d("2026-09-05")].into_iter().collect() },
            Person { weekly_hours: 35.0, capabilities: vec![], absent: HashSet::new() },
        ];
        // 8 h a day, every day: 240 h in September.
        let station = Station { id: Uuid::new_v4(), name: "ICU".into(), capabilities: vec![icu], hours_by_weekday: [8.0; 7], closed: vec![(d("2026-09-29"), d("2026-09-30"))] };
        let names: HashMap<Uuid, String> = [(icu, "ICU care".to_string())].into_iter().collect();
        let month = &forecast(&[d("2026-09-01")], &people, &[station], &names, &HashSet::new())[0];
        assert_eq!(month.month, "2026-09");
        assert_eq!(month.contracted_hours, 300.0, "2 × 35 h × 30/7");
        assert_eq!(month.absence_hours, 7.0, "one weekday absent (the 5th is a Saturday)");
        assert_eq!(month.available_hours, 293.0);
        assert_eq!(month.required_hours, 224.0, "28 open days × 8 h");
        assert_eq!(month.gap_hours, -69.0);
        let line = &month.capabilities[0];
        assert_eq!((line.name.as_str(), line.required_hours, line.available_hours), ("ICU care", 224.0, 143.0));
        assert_eq!(line.gap_hours, 81.0, "only one of them holds the capability");
    }

    #[test]
    fn a_holiday_counts_as_a_sunday() {
        let station = Station { id: Uuid::new_v4(), name: "W".into(), capabilities: vec![], hours_by_weekday: [8.0, 8.0, 8.0, 8.0, 8.0, 0.0, 0.0], closed: vec![] };
        let holidays: HashSet<NaiveDate> = [d("2026-10-01")].into_iter().collect();
        let plain = forecast(&[d("2026-10-01")], &[], &[station], &HashMap::new(), &HashSet::new())[0].required_hours;
        let station = Station { id: Uuid::new_v4(), name: "W".into(), capabilities: vec![], hours_by_weekday: [8.0, 8.0, 8.0, 8.0, 8.0, 0.0, 0.0], closed: vec![] };
        let with = forecast(&[d("2026-10-01")], &[], &[station], &HashMap::new(), &holidays)[0].required_hours;
        assert_eq!(plain - with, 8.0);
    }

    #[test]
    fn a_shift_running_past_midnight_counts_its_whole_span() {
        let h = |x| NaiveTime::from_hms_opt(x, 0, 0).unwrap();
        assert_eq!(span_hours(h(22), h(6), 30), 7.5);
        assert_eq!(span_hours(h(6), h(14), 0), 8.0);
    }
}
