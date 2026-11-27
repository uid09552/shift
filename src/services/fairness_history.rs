//! Long-term fairness: what the optimizer is told about the time before the
//! planning period, so that balancing does not restart at zero every period.
//!
//! - `balances`: nights, weekend days, public-holiday shifts and on-call
//!   duties per employee from the confirmed roster over the fairness horizon
//!   (`planner_settings.fairness_horizon_months`). The solver balances them per
//!   contract hour *including* these counts.
//! - `holiday_rotation`: whoever worked Christmas last year would rather have
//!   it off this year (and the same for New Year), sent as preferred days off —
//!   so the year-end holidays rotate instead of falling to the same people.

use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Months, NaiveDate};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::FairnessBalanceTask;
use crate::repository::domain::{AnalysisRepository, ConfirmedShiftPlanRepository};
use crate::repository::AppState;

/// The counts over `months` before `period_start`, per employee. Empty when
/// the horizon is 0 (switched off).
pub async fn balances(
    state: &AppState,
    tenant_id: &str,
    period_start: NaiveDate,
    months: i16,
) -> Result<HashMap<Uuid, FairnessBalanceTask>, AppError> {
    let Some((from, to)) = horizon(period_start, months) else {
        return Ok(HashMap::new());
    };
    let rows = state.analysis_repo.get_fairness(tenant_id, from, to, false).await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.employee_id,
                FairnessBalanceTask {
                    nights: r.night_shifts,
                    weekend_days: r.weekend_days,
                    holiday_shifts: r.holiday_shifts,
                    on_call: r.on_call_duties,
                },
            )
        })
        .collect())
}

/// `[period_start - months, period_start - 1]`, or None for a horizon of 0.
pub fn horizon(period_start: NaiveDate, months: i16) -> Option<(NaiveDate, NaiveDate)> {
    if months <= 0 {
        return None;
    }
    let from = period_start.checked_sub_months(Months::new(months as u32))?;
    Some((from, period_start.pred_opt()?))
}

/// The year-end holiday a day belongs to: Christmas (24–26 Dec) or New Year
/// (31 Dec – 1 Jan, keyed by the year of its 31 December).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum YearEnd {
    Christmas(i32),
    NewYear(i32),
}

impl YearEnd {
    pub fn of(day: NaiveDate) -> Option<YearEnd> {
        match (day.month(), day.day()) {
            (12, 24..=26) => Some(YearEnd::Christmas(day.year())),
            (12, 31) => Some(YearEnd::NewYear(day.year())),
            (1, 1) => Some(YearEnd::NewYear(day.year() - 1)),
            _ => None,
        }
    }

    pub fn days(self) -> Vec<NaiveDate> {
        let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).expect("a real day");
        match self {
            YearEnd::Christmas(y) => vec![d(y, 12, 24), d(y, 12, 25), d(y, 12, 26)],
            YearEnd::NewYear(y) => vec![d(y, 12, 31), d(y + 1, 1, 1)],
        }
    }

    pub fn year_before(self) -> YearEnd {
        match self {
            YearEnd::Christmas(y) => YearEnd::Christmas(y - 1),
            YearEnd::NewYear(y) => YearEnd::NewYear(y - 1),
        }
    }
}

/// For each holiday of the period, who worked it the year before: those
/// employees get its days in the period as preferred days off.
pub fn rotation_days(
    period: (NaiveDate, NaiveDate),
    worked_last_year: &HashSet<(Uuid, NaiveDate)>,
) -> HashMap<Uuid, Vec<NaiveDate>> {
    let (start, end) = period;
    let mut holidays: Vec<YearEnd> = Vec::new();
    let mut day = start;
    while day <= end {
        if let Some(h) = YearEnd::of(day) {
            if !holidays.contains(&h) {
                holidays.push(h);
            }
        }
        day = day.succ_opt().expect("a next day");
    }
    let mut out: HashMap<Uuid, Vec<NaiveDate>> = HashMap::new();
    for holiday in holidays {
        let before: HashSet<NaiveDate> = holiday.year_before().days().into_iter().collect();
        let who: HashSet<Uuid> = worked_last_year.iter().filter(|(_, d)| before.contains(d)).map(|(e, _)| *e).collect();
        for employee in who {
            out.entry(employee)
                .or_default()
                .extend(holiday.days().into_iter().filter(|d| *d >= start && *d <= end));
        }
    }
    for days in out.values_mut() {
        days.sort();
        days.dedup();
    }
    out
}

/// Preferred days off from last year's year-end holidays (see `rotation_days`).
pub async fn holiday_rotation(
    state: &AppState,
    tenant_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<HashMap<Uuid, Vec<NaiveDate>>, AppError> {
    let mut last_year: Vec<NaiveDate> = Vec::new();
    let mut day = period_start;
    while day <= period_end {
        if let Some(h) = YearEnd::of(day) {
            last_year.extend(h.year_before().days());
        }
        day = day.succ_opt().expect("a next day");
    }
    let (Some(from), Some(to)) = (last_year.iter().min().copied(), last_year.iter().max().copied()) else {
        return Ok(HashMap::new());
    };
    let worked: HashSet<(Uuid, NaiveDate)> = state
        .confirmed_shift_plan_repo
        .get_confirmed_shift_plans_for_date_range(tenant_id, from, to, None, None, false)
        .await?
        .into_iter()
        .filter(|p| p.is_present && p.shift_id.is_some())
        .map(|p| (p.employee_id, p.date))
        .collect();
    Ok(rotation_days((period_start, period_end), &worked))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn the_horizon_ends_the_day_before_the_period() {
        assert_eq!(horizon(d("2026-12-01"), 6), Some((d("2026-06-01"), d("2026-11-30"))));
        assert_eq!(horizon(d("2026-12-01"), 0), None);
    }

    #[test]
    fn new_year_spans_two_years() {
        assert_eq!(YearEnd::of(d("2027-01-01")), Some(YearEnd::NewYear(2026)));
        assert_eq!(YearEnd::NewYear(2026).year_before().days(), vec![d("2025-12-31"), d("2026-01-01")]);
        assert_eq!(YearEnd::of(d("2026-12-27")), None);
    }

    #[test]
    fn whoever_worked_christmas_last_year_would_rather_have_it_off() {
        let anna = Uuid::new_v4();
        let ben = Uuid::new_v4();
        let worked: HashSet<(Uuid, NaiveDate)> =
            [(anna, d("2025-12-25")), (ben, d("2026-01-01")), (ben, d("2025-12-20"))].into_iter().collect();
        let out = rotation_days((d("2026-12-20"), d("2027-01-05")), &worked);
        assert_eq!(out[&anna], vec![d("2026-12-24"), d("2026-12-25"), d("2026-12-26")]);
        assert_eq!(out[&ben], vec![d("2026-12-31"), d("2027-01-01")], "New Year, not Christmas");
    }

    #[test]
    fn only_days_inside_the_period_are_sent() {
        let anna = Uuid::new_v4();
        let worked: HashSet<(Uuid, NaiveDate)> = [(anna, d("2025-12-31"))].into_iter().collect();
        let out = rotation_days((d("2027-01-01"), d("2027-01-31")), &worked);
        assert_eq!(out[&anna], vec![d("2027-01-01")]);
        assert!(rotation_days((d("2026-03-01"), d("2026-03-31")), &worked).is_empty());
    }
}
