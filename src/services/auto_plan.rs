//! Automatic planning: the schedule decides *when* the optimizer runs on its own,
//! the range decides *what* it plans, and a clean result becomes the confirmed
//! roster. This module starts with the pure rules, which take the settings and a
//! clock and nothing else, so each can be tested on its own; the job that uses
//! them follows.
//!
//! Times are the server's local time, as the roster rules use (`roster_guard::today`).

use std::collections::HashMap;

use chrono::{Duration, Local, Months, NaiveDate, NaiveDateTime, Utc};
use uuid::Uuid;

use crate::models::TaskResultDto;
use crate::repository::domain::{
    effective_status, month_start, weekly_occurrence, ChangeSource, ConfirmedShiftPlan, ConfirmedShiftPlanRepository, MonthStatus,
    PlannerSettingsDomain, PlannerSettingsRepository, PlanningTaskDomain, RosterMonthRepository,
};
use crate::repository::AppState;
use crate::services::audit_log;
use crate::services::optimizer::{build_constraints, entries_from_plan, OptimizerService, PlanEntries};
use crate::services::roster_guard::{self, RosterChangeCtx};
use crate::services::workstation_unavailability::WorkstationClosures;

/// Whether `date` is a run day of the tenant's schedule.
pub fn occurs_on(settings: &PlannerSettingsDomain, date: NaiveDate) -> bool {
    settings.auto_plan_start_date.is_some_and(|start| {
        weekly_occurrence(start, settings.auto_plan_weekday, i32::from(settings.auto_plan_every_weeks), date)
    })
}

/// When the schedule's run on `date` happens.
fn run_time_on(settings: &PlannerSettingsDomain, date: NaiveDate) -> NaiveDateTime {
    date.and_time(settings.auto_plan_time)
}

/// Whether a run is due at `now`: the schedule is on, today is a run day, its
/// time has come, today has not been claimed yet, and the schedule was not
/// switched on or changed after today's time (a run day whose time had already
/// passed then must not run). `armed` is that moment in the same clock as `now`.
pub fn is_due(settings: &PlannerSettingsDomain, now: NaiveDateTime, armed: Option<NaiveDateTime>) -> bool {
    let today = now.date();
    let at = run_time_on(settings, today);
    settings.auto_plan_enabled
        && occurs_on(settings, today)
        && now >= at
        && settings.auto_plan_last_run_on != Some(today)
        && armed.map_or(true, |armed| at >= armed)
}

/// The next time a run happens (or is due right now): the earliest run day,
/// today included, whose time the schedule may still use. `None` while the
/// schedule is off or has no start date.
pub fn next_run(settings: &PlannerSettingsDomain, now: NaiveDateTime, armed: Option<NaiveDateTime>) -> Option<NaiveDateTime> {
    if !settings.auto_plan_enabled || settings.auto_plan_start_date.is_none() {
        return None;
    }
    // Twelve weeks is the longest interval; a little more covers the weekday offset.
    // A start date in the future is where the cycle begins.
    let from = settings.auto_plan_start_date.map_or(now.date(), |start| start.max(now.date()));
    (0..=7 * 13).find_map(|ahead| {
        let date = from + Duration::days(ahead);
        let at = run_time_on(settings, date);
        let usable = occurs_on(settings, date)
            && settings.auto_plan_last_run_on != Some(date)
            && armed.map_or(true, |armed| at >= armed)
            && (date > now.date() || now >= at || at > now);
        usable.then_some(at)
    })
}

/// What a run plans.
#[derive(Debug, PartialEq, Eq)]
pub enum Window {
    /// From `start` to `end`, both included.
    Plan { start: NaiveDate, end: NaiveDate },
    /// The roster already reaches far enough: nothing to plan.
    AlreadyPlanned { until: NaiveDate },
}

/// The range a run on `run_day` plans: from the day after the last planned day
/// (never before the day after the run day) to the day the range lies after the
/// run day, calendar months clamped to the month's end. A start beyond that end
/// means the roster already reaches far enough.
pub fn plan_window(run_day: NaiveDate, range_unit: &str, range_count: i16, last_planned: Option<NaiveDate>) -> Window {
    let count = i64::from(range_count.max(1));
    let end = match range_unit {
        "months" => run_day
            .checked_add_months(Months::new(count as u32))
            .unwrap_or(run_day + Duration::days(31 * count)),
        _ => run_day + Duration::days(7 * count),
    };
    let earliest = run_day + Duration::days(1);
    let start = last_planned.map_or(earliest, |last| (last + Duration::days(1)).max(earliest));
    if start > end {
        Window::AlreadyPlanned { until: last_planned.unwrap_or(end) }
    } else {
        Window::Plan { start, end }
    }
}

// ── The job ─────────────────────────────────────────────────────────────────

/// Who the audit log names for what the schedule does.
const ACTOR: &str = "auto-planner";

/// A run still waiting for the planner after this long is failed.
const STALE_AFTER_HOURS: i64 = 3;

/// Checks every tenant's schedule once a minute.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            tick.tick().await;
            run_once(&state, Local::now().naive_local()).await;
        }
    });
}

/// One tick: fail runs that never got an answer, then start every run that is due.
pub async fn run_once(state: &AppState, now: NaiveDateTime) {
    match state.planner_settings_repo.fail_stale_auto_plan_runs(now - Duration::hours(STALE_AFTER_HOURS)).await {
        Ok(tenants) => {
            for tenant in tenants {
                audit_result(state, &tenant, "failed", Some("The planner did not answer in time"), None).await;
            }
        }
        Err(e) => eprintln!("Auto plan: could not sweep stale runs: {e}"),
    }

    let enabled = match state.planner_settings_repo.list_auto_plan_enabled().await {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Auto plan: could not list tenants: {e}");
            return;
        }
    };
    for (tenant, settings) in enabled {
        if !is_due(&settings, now, settings.auto_plan_armed_at) {
            continue;
        }
        // Only the instance whose update touched the row goes on.
        match state.planner_settings_repo.claim_auto_plan_run(&tenant, now.date(), now).await {
            Ok(true) => start_run(state, &tenant, &settings, now.date()).await,
            Ok(false) => {}
            Err(e) => eprintln!("Auto plan: tenant {tenant} could not be claimed: {e}"),
        }
    }
}

/// Records how a run ended: the settings page's status and the audit log.
async fn finish(state: &AppState, tenant: &str, outcome: &str, note: Option<String>, task_id: Option<Uuid>) {
    if let Err(e) = state.planner_settings_repo.set_auto_plan_outcome(tenant, outcome, note.clone(), task_id).await {
        eprintln!("Auto plan: tenant {tenant}: could not record the outcome: {e}");
    }
    audit_result(state, tenant, outcome, note.as_deref(), task_id).await;
}

async fn audit_result(state: &AppState, tenant: &str, outcome: &str, note: Option<&str>, task_id: Option<Uuid>) {
    let changes = serde_json::json!({ "outcome": outcome, "note": note, "task_id": task_id }).to_string();
    audit_log::record(state, tenant, Some(ACTOR.into()), "planner.auto_result", "planning_task", task_id.map(|t| t.to_string()), Some(changes)).await;
}

/// Starts the run of a claimed run day: work out the range, ask the planner.
/// Every way out ends in a recorded outcome; the answer comes to `on_result`.
pub async fn start_run(state: &AppState, tenant: &str, settings: &PlannerSettingsDomain, run_day: NaiveDate) {
    let last = match state.confirmed_shift_plan_repo.last_planned_day(tenant).await {
        Ok(last) => last,
        Err(e) => return finish(state, tenant, "failed", Some(format!("The roster could not be read: {e}")), None).await,
    };
    let (start, end) = match plan_window(run_day, &settings.auto_plan_range_unit, settings.auto_plan_range_count, last) {
        Window::AlreadyPlanned { until } => {
            return finish(state, tenant, "skipped", Some(format!("Already planned until {until}")), None).await;
        }
        Window::Plan { start, end } => (start, end),
    };
    if state.nats_client.is_none() {
        return finish(state, tenant, "failed", Some("The planner is not connected (no NATS)".into()), None).await;
    }

    let task_id = Uuid::new_v4();
    let constraints = build_constraints(state, tenant, None).await;
    let started = OptimizerService::new(state.clone())
        .schedule(tenant, task_id, None, Some(&start.to_string()), Some(&end.to_string()), Some(constraints), "auto")
        .await;
    if let Err(e) = started {
        return finish(state, tenant, "failed", Some(format!("The run could not be started: {e}")), None).await;
    }

    let changes = serde_json::json!({ "start_date": start, "end_date": end }).to_string();
    audit_log::record(state, tenant, Some(ACTOR.into()), "planner.auto_run", "planning_task", Some(task_id.to_string()), Some(changes)).await;
    if let Err(e) = state.planner_settings_repo.set_auto_plan_outcome(tenant, "running", None, Some(task_id)).await {
        eprintln!("Auto plan: tenant {tenant}: could not record the run: {e}");
    }
}

/// The solver failed.
pub async fn on_failure(state: &AppState, task: &PlanningTaskDomain, message: &str) {
    finish(state, &task.tenant_id, "failed", Some(format!("The planner reported an error: {message}")), Some(task.id)).await;
}

/// The solver answered: take the plan over if it is safe, else leave it a proposal.
pub async fn on_result(state: &AppState, task: &PlanningTaskDomain, result: &TaskResultDto) {
    let tenant = task.tenant_id.as_str();
    let (outcome, note) = match take_over_if_safe(state, tenant, result).await {
        Ok(Decision::TakeOver) => ("taken_over", Some(taken_note(result))),
        Ok(Decision::Keep(reason)) => ("kept_as_proposal", Some(reason)),
        Err(reason) => ("kept_as_proposal", Some(reason)),
    };
    finish(state, tenant, outcome, note, Some(task.id)).await;
}

fn taken_note(result: &TaskResultDto) -> String {
    format!("Planned {} to {}", result.planning_period.start_date, result.planning_period.end_date)
}

/// Decides, and writes when the answer is yes. `Err` carries a reason in words
/// (the plan stays a proposal), including a roster write the guard refused.
async fn take_over_if_safe(state: &AppState, tenant: &str, result: &TaskResultDto) -> Result<Decision, String> {
    let parse = |text: &str| NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| "The result has no valid period".to_string());
    let from = parse(&result.planning_period.start_date)?;
    let to = parse(&result.planning_period.end_date)?;
    let read = |e: crate::errors::AppError| format!("The roster could not be read: {e}");

    let closures = WorkstationClosures::load(state, tenant).await.map_err(read)?;
    let PlanEntries { employee_ids, entries, closed } =
        entries_from_plan(&result.employee_plans, |ws, date| closures.closed_reason(ws, date), Utc::now().naive_utc());

    let today = roster_guard::today();
    let mut months = Vec::new();
    let last_month = month_start(to);
    let mut month = month_start(from);
    let stored = state.roster_month_repo.list_roster_months(tenant, month, last_month).await.map_err(read)?;
    while month <= last_month {
        let row = stored.iter().find(|r| r.month == month);
        months.push((month, effective_status(row, month, today)));
        month = month.checked_add_months(Months::new(1)).unwrap_or(NaiveDate::MAX);
    }

    let absences: Vec<RecordedAbsence> = state
        .confirmed_shift_plan_repo
        .get_confirmed_shift_plans_for_date_range(tenant, from, to, None, None, false)
        .await
        .map_err(read)?
        .into_iter()
        .filter(|p| p.shift_id.is_none())
        .filter_map(|p| Some(RecordedAbsence { employee_id: p.employee_id, date: p.date, absence_type: p.absence_type? }))
        .collect();

    let decision = decide(result, &months, &absences, &closed, &entries);
    if decision != Decision::TakeOver {
        return Ok(decision);
    }

    let settings = state.planner_settings_repo.get_or_create_planner_settings(tenant).await.map_err(read)?;
    let ctx = RosterChangeCtx {
        is_admin: false,
        actor: Some(ACTOR.into()),
        reason: None,
        source: ChangeSource::TakeAsPlan,
        today,
        freeze_days: i64::from(settings.freeze_days),
    };
    match state.confirmed_shift_plan_repo.apply_automated_plan(tenant, &employee_ids, from, to, entries, &ctx).await {
        Ok(_) => Ok(Decision::TakeOver),
        // The guard refused (a month was published meanwhile): nothing was written.
        Err(e) => Ok(Decision::Keep(format!("The roster refused the plan: {e}"))),
    }
}

/// What to do with a finished automatic plan.
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    /// Confirm it as the roster.
    TakeOver,
    /// Leave it as a proposal; the reason goes on the settings page.
    Keep(String),
}

/// A day a person recorded as absent (a roster entry without a shift).
pub struct RecordedAbsence {
    pub employee_id: Uuid,
    pub date: NaiveDate,
    pub absence_type: String,
}

/// The absences the solver is not told about. `unavailable` entries mirror a hard
/// unavailability the solver already honours; `free` is a plan's own free day.
fn solver_blind(absence_type: &str) -> bool {
    matches!(absence_type, "sick" | "day_off" | "holiday" | "unknown")
}

/// Whether a plan may become the roster without a person looking at it: the
/// solver has nothing to flag, every month it touches is still a draft, nobody is
/// planned on a recorded absence, and no workstation it uses is closed. The first
/// reason found is the answer, in that order.
pub fn decide(
    result: &TaskResultDto,
    months: &[(NaiveDate, MonthStatus)],
    absences: &[RecordedAbsence],
    closed: &[String],
    entries: &[ConfirmedShiftPlan],
) -> Decision {
    if !matches!(result.status.as_str(), "optimal" | "feasible") {
        return Decision::Keep(format!("The solver ended with status \"{}\"", result.status));
    }
    if let Some(message) = result.message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        return Decision::Keep(format!("The solver reported: {message}"));
    }
    if let Some((month, status)) = months.iter().filter(|(_, s)| *s != MonthStatus::Draft).min_by_key(|(m, _)| *m) {
        return Decision::Keep(format!("{} is {}", month.format("%B %Y"), status.as_str()));
    }

    let names: HashMap<&str, &str> =
        result.employee_plans.iter().map(|p| (p.employee_id.as_str(), p.employee_name.as_str())).collect();
    let mut planned: Vec<&ConfirmedShiftPlan> = entries.iter().filter(|e| e.shift_id.is_some()).collect();
    planned.sort_by_key(|e| (e.date, e.employee_id));
    for entry in planned {
        let clash = absences
            .iter()
            .find(|a| a.employee_id == entry.employee_id && a.date == entry.date && solver_blind(&a.absence_type));
        if let Some(absence) = clash {
            let name = names.get(entry.employee_id.to_string().as_str()).copied().unwrap_or("An employee");
            return Decision::Keep(format!(
                "{name} is recorded as {} on {} but is planned",
                absence.absence_type.replace('_', " "),
                entry.date
            ));
        }
    }

    if !closed.is_empty() {
        let shown = closed.iter().take(3).cloned().collect::<Vec<_>>().join("; ");
        let more = closed.len().saturating_sub(3);
        let more = if more > 0 { format!("; and {more} more") } else { String::new() };
        return Decision::Keep(format!("{} assignment(s) fall on a closed workstation: {shown}{more}", closed.len()));
    }
    Decision::TakeOver
}

#[cfg(test)]
mod tests {
    use chrono::NaiveTime;

    use super::*;
    use crate::repository::domain::weekly_occurrence;

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    fn at(date: &str, time: &str) -> NaiveDateTime {
        day(date).and_time(NaiveTime::parse_from_str(time, "%H:%M").unwrap())
    }

    /// Every `weeks` weeks on `weekday` (0 = Monday) at 02:00, from `start`.
    fn schedule(weeks: i16, weekday: i16, start: &str) -> PlannerSettingsDomain {
        PlannerSettingsDomain {
            night_shift_recovery_days: 2,
            min_rest_hours: 11.0,
            max_consecutive_days: 6,
            max_working_days_per_week: 5,
            equality_weight: 0,
            priority_weight_high: 0,
            priority_weight_medium: 0,
            priority_weight_low: 0,
            monthly_hours_target_weight: 0,
            solver_time_limit_seconds: 1.0,
            solver_num_workers: 1,
            updated_at: at("2026-10-01", "00:00"),
            weekly_min_hours: None,
            weekly_max_hours: None,
            weekly_hours_target_weight: 0,
            preference_weight: 0,
            skill_downgrade_weight: 0,
            fatigue_weight: 0,
            night_shift_fatigue_multiplier: 1.0,
            shift_continuity_weight: 0,
            shift_continuity_week_bonus: 0,
            wish_weight: 0,
            min_staffing_mode: crate::repository::domain::MinStaffingMode::Soft,
            keep_fixed_assignments: true,
            personal_limits_mode: crate::repository::domain::MinStaffingMode::Hard,
            default_weekly_working_hours: 40.0,
            publish_lead_days: 28,
            freeze_days: 7,
            change_weight: 0,
            labor_law_profile: "none".into(),
            labor_law_averaging_weeks: 24,
            use_case: None,
            auto_plan_enabled: true,
            auto_plan_every_weeks: weeks,
            auto_plan_weekday: weekday,
            auto_plan_time: NaiveTime::from_hms_opt(2, 0, 0).unwrap(),
            auto_plan_start_date: Some(day(start)),
            auto_plan_range_unit: "weeks".into(),
            auto_plan_range_count: 4,
            auto_plan_armed_at: None,
            auto_plan_last_run_on: None,
            auto_plan_last_outcome: None,
            auto_plan_last_note: None,
            auto_plan_last_task_id: None,
            auto_plan_last_started_at: None,
        }
    }

    // ── run days ────────────────────────────────────────────────────────────

    #[test]
    fn every_second_week_runs_on_the_monday_of_every_second_week() {
        let s = schedule(2, 0, "2026-10-05");
        assert!(occurs_on(&s, day("2026-10-05")));
        assert!(!occurs_on(&s, day("2026-10-12")));
        assert!(occurs_on(&s, day("2026-10-19")));
        assert!(!occurs_on(&s, day("2026-10-06")), "not on another weekday");
        assert!(!occurs_on(&s, day("2026-09-21")), "nor before the start date");
    }

    #[test]
    fn the_shared_arithmetic_is_what_the_wish_schedule_uses() {
        assert!(weekly_occurrence(day("2026-10-05"), 0, 2, day("2026-10-19")));
        assert!(!weekly_occurrence(day("2026-10-05"), 0, 2, day("2026-10-12")));
    }

    #[test]
    fn a_start_date_in_mid_week_anchors_the_week_it_falls_in() {
        // Started on a Thursday: the cycle counts from that week's Monday.
        let s = schedule(2, 0, "2026-10-08");
        assert!(!occurs_on(&s, day("2026-10-05")), "before the start date");
        // 2026-10-08 is in the week of Monday 2026-10-05, so that week is cycle week 0.
        assert!(!occurs_on(&s, day("2026-10-12")));
        assert!(occurs_on(&s, day("2026-10-19")));
    }

    #[test]
    fn nothing_runs_without_a_start_date() {
        let mut s = schedule(1, 0, "2026-10-05");
        s.auto_plan_start_date = None;
        assert!(!occurs_on(&s, day("2026-10-05")));
        assert_eq!(next_run(&s, at("2026-10-05", "01:00"), None), None);
    }

    // ── due ─────────────────────────────────────────────────────────────────

    #[test]
    fn a_run_is_due_from_the_set_time_on_a_run_day() {
        let s = schedule(2, 0, "2026-10-05");
        assert!(!is_due(&s, at("2026-10-05", "01:59"), None), "before the time");
        assert!(is_due(&s, at("2026-10-05", "02:00"), None));
        assert!(is_due(&s, at("2026-10-05", "17:30"), None), "a server that was down at 02:00 still runs it that day");
        assert!(!is_due(&s, at("2026-10-12", "09:00"), None), "not a run day");
    }

    #[test]
    fn a_run_is_not_due_twice_on_one_day() {
        let mut s = schedule(2, 0, "2026-10-05");
        s.auto_plan_last_run_on = Some(day("2026-10-05"));
        assert!(!is_due(&s, at("2026-10-05", "09:00"), None), "restarting the server must not run it again");
        s.auto_plan_last_run_on = Some(day("2026-09-21"));
        assert!(is_due(&s, at("2026-10-05", "09:00"), None), "an earlier day's claim does not count");
    }

    #[test]
    fn a_run_is_not_due_while_the_schedule_is_off() {
        let mut s = schedule(2, 0, "2026-10-05");
        s.auto_plan_enabled = false;
        assert!(!is_due(&s, at("2026-10-05", "09:00"), None));
    }

    #[test]
    fn a_schedule_switched_on_after_the_time_waits_for_the_next_run_day() {
        let s = schedule(2, 0, "2026-10-05");
        let armed = Some(at("2026-10-05", "14:00")); // switched on at 14:00, the run was at 02:00
        assert!(!is_due(&s, at("2026-10-05", "14:01"), armed));
        assert_eq!(next_run(&s, at("2026-10-05", "14:01"), armed), Some(at("2026-10-19", "02:00")));
        let before = Some(at("2026-10-05", "01:00")); // switched on at 01:00: today's run still counts
        assert!(is_due(&s, at("2026-10-05", "02:05"), before));
    }

    // ── next run ────────────────────────────────────────────────────────────

    #[test]
    fn the_next_run_is_the_coming_run_day_at_the_set_time() {
        let s = schedule(2, 0, "2026-10-05");
        assert_eq!(next_run(&s, at("2026-10-05", "01:00"), None), Some(at("2026-10-05", "02:00")), "later today");
        assert_eq!(next_run(&s, at("2026-10-06", "09:00"), None), Some(at("2026-10-19", "02:00")));
        assert_eq!(next_run(&s, at("2026-10-19", "12:00"), None), Some(at("2026-10-19", "02:00")), "due now: it has not run today");
    }

    #[test]
    fn the_next_run_skips_a_day_that_was_already_claimed() {
        let mut s = schedule(2, 0, "2026-10-05");
        s.auto_plan_last_run_on = Some(day("2026-10-05"));
        assert_eq!(next_run(&s, at("2026-10-05", "09:00"), None), Some(at("2026-10-19", "02:00")));
    }

    #[test]
    fn the_next_run_is_found_for_the_longest_interval() {
        let s = schedule(12, 3, "2026-10-05");
        assert!(next_run(&s, at("2026-10-09", "12:00"), None).is_some());
    }

    // ── the range ───────────────────────────────────────────────────────────

    #[test]
    fn the_range_starts_after_the_last_planned_day() {
        let w = plan_window(day("2026-10-05"), "weeks", 4, Some(day("2026-10-18")));
        assert_eq!(w, Window::Plan { start: day("2026-10-19"), end: day("2026-11-02") });
    }

    #[test]
    fn an_empty_roster_is_planned_from_the_day_after_the_run_day() {
        let w = plan_window(day("2026-10-05"), "weeks", 4, None);
        assert_eq!(w, Window::Plan { start: day("2026-10-06"), end: day("2026-11-02") });
    }

    #[test]
    fn a_roster_that_ends_in_the_past_is_planned_from_tomorrow_not_from_the_gap() {
        let w = plan_window(day("2026-10-05"), "weeks", 2, Some(day("2026-09-01")));
        assert_eq!(w, Window::Plan { start: day("2026-10-06"), end: day("2026-10-19") });
    }

    #[test]
    fn months_are_calendar_months_clamped_to_the_months_end() {
        let w = plan_window(day("2026-01-31"), "months", 1, None);
        assert_eq!(w, Window::Plan { start: day("2026-02-01"), end: day("2026-02-28") });
        let w = plan_window(day("2026-10-05"), "months", 3, None);
        assert_eq!(w, Window::Plan { start: day("2026-10-06"), end: day("2027-01-05") });
    }

    #[test]
    fn a_roster_that_already_reaches_the_end_is_not_planned_again() {
        let w = plan_window(day("2026-10-05"), "weeks", 4, Some(day("2026-11-02")));
        assert_eq!(w, Window::AlreadyPlanned { until: day("2026-11-02") });
        let w = plan_window(day("2026-10-05"), "weeks", 4, Some(day("2026-12-31")));
        assert_eq!(w, Window::AlreadyPlanned { until: day("2026-12-31") });
        // one day short: still a one-day window
        let w = plan_window(day("2026-10-05"), "weeks", 4, Some(day("2026-11-01")));
        assert_eq!(w, Window::Plan { start: day("2026-11-02"), end: day("2026-11-02") });
    }

    #[test]
    fn every_offered_range_ends_where_it_says() {
        let run = day("2026-10-05");
        let end = |unit: &str, count: i16| match plan_window(run, unit, count, None) {
            Window::Plan { end, .. } => end,
            other => panic!("{other:?}"),
        };
        assert_eq!(end("weeks", 2), day("2026-10-19"));
        assert_eq!(end("weeks", 12), day("2026-12-28"));
        assert_eq!(end("months", 2), day("2026-12-05"));
    }

    // ── the decision ────────────────────────────────────────────────────────

    fn result(status: &str, message: Option<&str>) -> TaskResultDto {
        serde_json::from_value(serde_json::json!({
            "status": status,
            "planning_period": { "start_date": "2026-11-02", "end_date": "2026-11-08" },
            "message": message,
            "employee_plans": [{ "employee_id": ANNA, "employee_name": "Anna Berg", "daily_plan": [] }],
        }))
        .unwrap()
    }

    const ANNA: &str = "00000000-0000-0000-0000-0000000000a1";

    fn entry(date: &str, shifted: bool) -> ConfirmedShiftPlan {
        let now = at("2026-10-25", "00:00");
        ConfirmedShiftPlan {
            id: Uuid::new_v4(),
            employee_id: ANNA.parse().unwrap(),
            shift_id: shifted.then(Uuid::new_v4),
            workstation_id: None,
            date: day(date),
            is_present: shifted,
            absence_type: (!shifted).then(|| "free".to_string()),
            creation_type: "automated".into(),
            created_at: now,
            updated_at: now,
        }
    }

    fn absence(date: &str, kind: &str) -> RecordedAbsence {
        RecordedAbsence { employee_id: ANNA.parse().unwrap(), date: day(date), absence_type: kind.into() }
    }

    fn drafts() -> Vec<(NaiveDate, MonthStatus)> {
        vec![(day("2026-11-01"), MonthStatus::Draft)]
    }

    #[test]
    fn a_clean_plan_in_draft_months_is_taken_over() {
        let d = decide(&result("optimal", None), &drafts(), &[], &[], &[entry("2026-11-03", true)]);
        assert_eq!(d, Decision::TakeOver);
        let d = decide(&result("feasible", Some("  ")), &drafts(), &[], &[], &[]);
        assert_eq!(d, Decision::TakeOver, "a blank message flags nothing");
    }

    #[test]
    fn a_solver_status_other_than_optimal_or_feasible_stays_a_proposal() {
        for status in ["infeasible", "unknown", "model_invalid"] {
            let Decision::Keep(reason) = decide(&result(status, None), &drafts(), &[], &[], &[]) else {
                panic!("{status} must be kept");
            };
            assert!(reason.contains(status), "{reason}");
        }
    }

    #[test]
    fn anything_the_solver_reports_keeps_the_plan_a_proposal() {
        let message = "2 slots below minimum staffing: Early on 2026-11-04";
        let d = decide(&result("feasible", Some(message)), &drafts(), &[], &[], &[]);
        assert_eq!(d, Decision::Keep(format!("The solver reported: {message}")));
    }

    #[test]
    fn a_published_or_locked_month_keeps_the_plan_a_proposal() {
        let months = vec![(day("2026-11-01"), MonthStatus::Draft), (day("2026-12-01"), MonthStatus::Published)];
        assert_eq!(
            decide(&result("optimal", None), &months, &[], &[], &[]),
            Decision::Keep("December 2026 is published".into())
        );
        let months = vec![(day("2026-11-01"), MonthStatus::Locked)];
        assert_eq!(
            decide(&result("optimal", None), &months, &[], &[], &[]),
            Decision::Keep("November 2026 is locked".into())
        );
    }

    #[test]
    fn a_plan_on_a_recorded_absence_names_the_person_and_day() {
        for kind in ["sick", "day_off", "holiday", "unknown"] {
            let d = decide(&result("optimal", None), &drafts(), &[absence("2026-11-03", kind)], &[], &[entry("2026-11-03", true)]);
            let expected = format!("Anna Berg is recorded as {} on 2026-11-03 but is planned", kind.replace('_', " "));
            assert_eq!(d, Decision::Keep(expected));
        }
    }

    #[test]
    fn an_absence_on_a_free_day_or_an_unavailable_mirror_is_no_conflict() {
        // planned free on the sick day: nothing is asked of the person
        let d = decide(&result("optimal", None), &drafts(), &[absence("2026-11-03", "sick")], &[], &[entry("2026-11-03", false)]);
        assert_eq!(d, Decision::TakeOver);
        // `unavailable` mirrors a hard unavailability the solver already honours
        let d = decide(&result("optimal", None), &drafts(), &[absence("2026-11-03", "unavailable")], &[], &[entry("2026-11-03", true)]);
        assert_eq!(d, Decision::TakeOver);
    }

    #[test]
    fn a_closed_workstation_keeps_the_plan_a_proposal() {
        let closed = vec!["Anna Berg on 2026-11-03 (ICU is deactivated)".to_string()];
        let Decision::Keep(reason) = decide(&result("optimal", None), &drafts(), &[], &closed, &[entry("2026-11-03", true)]) else {
            panic!("must be kept");
        };
        assert!(reason.starts_with("1 assignment(s) fall on a closed workstation"), "{reason}");
        assert!(reason.contains("ICU is deactivated"));
    }
}
