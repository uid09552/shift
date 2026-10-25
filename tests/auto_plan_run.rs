//! Automatic planning end to end, below the HTTP layer: the claim that makes a run
//! day run once, the range a run plans, the write that never touches a person's
//! entry, and what a finished plan becomes. The solver and NATS are not involved:
//! answers are crafted and fed to `handle_result_message`, as the subscriber does.
//!
//! Needs PostgreSQL (`DATABASE_URL`, or the development default); without one the
//! tests print a notice and pass.

mod common;
mod roster_support;

use std::sync::Arc;

use chrono::{Datelike, Local, NaiveDate};
use diesel::prelude::*;
use serde_json::json;
use uuid::Uuid;

use roster_support::TestApp;
use shift::repository::domain::{
    ChangeSource, ConfirmedShiftPlan, ConfirmedShiftPlanRepository, PlannerSettingsRepository, PlanningTaskRepository,
};
use shift::repository::AppState;
use shift::schema::{audit_logs, confirmed_shift_plans, optimized_shift_results, planner_settings, planning_tasks};
use shift::services::optimizer::handle_result_message;
use shift::services::roster_guard::RosterChangeCtx;

macro_rules! app {
    () => {
        match TestApp::spawn("auto-run").await {
            Some(app) => app,
            None => return,
        }
    };
}

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn state(app: &TestApp) -> AppState {
    AppState::new(Arc::new(app.pool.clone()))
}

fn ctx(is_admin: bool) -> RosterChangeCtx {
    RosterChangeCtx {
        is_admin,
        actor: Some("auto-planner".into()),
        reason: None,
        source: ChangeSource::TakeAsPlan,
        today: Local::now().date_naive(),
        freeze_days: 7,
    }
}

fn entry(employee: Uuid, date: NaiveDate, shift: Option<Uuid>, creation: &str) -> ConfirmedShiftPlan {
    let now = chrono::Utc::now().naive_utc();
    ConfirmedShiftPlan {
        id: Uuid::new_v4(),
        employee_id: employee,
        shift_id: shift,
        workstation_id: None,
        date,
        is_present: shift.is_some(),
        absence_type: shift.is_none().then(|| "free".to_string()),
        creation_type: creation.into(),
        created_at: now,
        updated_at: now,
    }
}

/// Switches the schedule on, due right now: today is the run day, its time is 00:00.
fn schedule_today(app: &TestApp) {
    let today = Local::now().date_naive();
    let mut conn = app.pool.get().unwrap();
    diesel::insert_into(planner_settings::table)
        .values(shift::models::NewPlannerSettings::defaults(&app.tenant))
        .on_conflict_do_nothing()
        .execute(&mut conn)
        .unwrap();
    diesel::update(planner_settings::table.filter(planner_settings::tenant_id.eq(&app.tenant)))
        .set((
            planner_settings::auto_plan_enabled.eq(true),
            planner_settings::auto_plan_every_weeks.eq(1i16),
            planner_settings::auto_plan_weekday.eq(today.weekday().num_days_from_monday() as i16),
            planner_settings::auto_plan_time.eq(chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
            planner_settings::auto_plan_start_date.eq(Some(today)),
            planner_settings::auto_plan_armed_at.eq(None::<chrono::NaiveDateTime>),
            planner_settings::auto_plan_last_run_on.eq(None::<NaiveDate>),
        ))
        .execute(&mut conn)
        .unwrap();
}

async fn outcome(state: &AppState, app: &TestApp) -> (Option<String>, Option<String>) {
    let s = state.planner_settings_repo.get_or_create_planner_settings(&app.tenant).await.unwrap();
    (s.auto_plan_last_outcome, s.auto_plan_last_note)
}

fn audited(app: &TestApp, action: &str) -> i64 {
    let mut conn = app.pool.get().unwrap();
    audit_logs::table
        .filter(audit_logs::tenant_id.eq(&app.tenant))
        .filter(audit_logs::action.eq(action))
        .count()
        .get_result(&mut conn)
        .unwrap()
}

fn cleanup(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    let _ = diesel::delete(planning_tasks::table.filter(planning_tasks::tenant_id.eq(&app.tenant))).execute(&mut conn);
    let _ = diesel::delete(optimized_shift_results::table.filter(optimized_shift_results::tenant_id.eq(&app.tenant)))
        .execute(&mut conn);
    app.cleanup();
}

// ── the claim and the range ─────────────────────────────────────────────────

#[tokio::test]
async fn a_run_day_can_be_claimed_once() {
    let app = app!();
    let state = state(&app);
    schedule_today(&app);
    let (today, now) = (Local::now().date_naive(), Local::now().naive_local());

    assert!(state.planner_settings_repo.claim_auto_plan_run(&app.tenant, today, now).await.unwrap());
    assert!(!state.planner_settings_repo.claim_auto_plan_run(&app.tenant, today, now).await.unwrap(), "a second claim the same day is refused");
    assert_eq!(outcome(&state, &app).await.0.as_deref(), Some("running"));
    let tomorrow = today + chrono::Duration::days(1);
    assert!(state.planner_settings_repo.claim_auto_plan_run(&app.tenant, tomorrow, now).await.unwrap(), "the next day is another claim");

    cleanup(&app);
}

#[tokio::test]
async fn of_eight_concurrent_claims_exactly_one_wins() {
    let app = app!();
    let state = state(&app);
    schedule_today(&app);
    let (today, now) = (Local::now().date_naive(), Local::now().naive_local());

    let mut claims = Vec::new();
    for _ in 0..8 {
        let repo = state.planner_settings_repo.clone();
        let tenant = app.tenant.clone();
        claims.push(tokio::spawn(async move { repo.claim_auto_plan_run(&tenant, today, now).await.unwrap() }));
    }
    let mut winners = 0;
    for claim in claims {
        winners += usize::from(claim.await.unwrap());
    }
    assert_eq!(winners, 1);

    cleanup(&app);
}

#[tokio::test]
async fn a_schedule_that_is_off_cannot_be_claimed() {
    let app = app!();
    let state = state(&app);
    schedule_today(&app);
    {
        let mut conn = app.pool.get().unwrap();
        diesel::update(planner_settings::table.filter(planner_settings::tenant_id.eq(&app.tenant)))
            .set(planner_settings::auto_plan_enabled.eq(false))
            .execute(&mut conn)
            .unwrap();
    }
    let claimed = state.planner_settings_repo.claim_auto_plan_run(&app.tenant, Local::now().date_naive(), Local::now().naive_local()).await.unwrap();
    assert!(!claimed);

    cleanup(&app);
}

#[tokio::test]
async fn the_last_planned_day_counts_shifts_only() {
    let app = app!();
    let state = state(&app);
    assert_eq!(state.confirmed_shift_plan_repo.last_planned_day(&app.tenant).await.unwrap(), None);

    app.roster(app.anna.id, d(2099, 3, 2), Some(app.early));
    app.roster(app.anna.id, d(2099, 3, 20), None); // a free day far ahead
    {
        let mut conn = app.pool.get().unwrap();
        diesel::update(
            confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&app.tenant))
                .filter(confirmed_shift_plans::date.eq(d(2099, 3, 20))),
        )
        .set(confirmed_shift_plans::absence_type.eq(Some("sick")))
        .execute(&mut conn)
        .unwrap();
    }
    assert_eq!(state.confirmed_shift_plan_repo.last_planned_day(&app.tenant).await.unwrap(), Some(d(2099, 3, 2)));

    cleanup(&app);
}

// ── the write ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn an_automatic_write_replaces_automatic_entries_and_leaves_a_persons_entry() {
    let app = app!();
    let state = state(&app);
    let (anna, ben) = (app.anna.id, app.ben.id);
    let (from, to) = (d(2099, 3, 2), d(2099, 3, 8));

    app.roster(anna, d(2099, 3, 2), Some(app.late)); // an earlier automatic plan
    app.roster(anna, d(2099, 3, 3), Some(app.late));
    // a person's entry: Anna works the Early shift on the 4th, entered by hand
    let manual = app.roster(anna, d(2099, 3, 4), Some(app.early));
    {
        let mut conn = app.pool.get().unwrap();
        diesel::update(confirmed_shift_plans::table.filter(confirmed_shift_plans::id.eq(manual)))
            .set(confirmed_shift_plans::creation_type.eq("manual"))
            .execute(&mut conn)
            .unwrap();
    }

    let plan = vec![
        entry(anna, d(2099, 3, 2), Some(app.early), "automated"),
        entry(anna, d(2099, 3, 3), None, "automated"),
        entry(anna, d(2099, 3, 4), Some(app.late), "automated"), // collides with the manual one
        entry(ben, d(2099, 3, 2), Some(app.early), "automated"),
    ];
    let inserted = state.confirmed_shift_plan_repo.apply_automated_plan(&app.tenant, &[anna, ben], from, to, plan, &ctx(false)).await.unwrap();
    assert_eq!(inserted, 3, "the manual day is skipped, not overwritten");

    assert_eq!(app.roster_cell(anna, d(2099, 3, 2)), Some(Some(app.early)), "the earlier automatic entry was replaced");
    assert_eq!(app.roster_cell(anna, d(2099, 3, 3)), Some(None));
    assert_eq!(app.roster_cell(anna, d(2099, 3, 4)), Some(Some(app.early)), "the person's entry stays as it was");
    assert_eq!(app.roster_cell(ben, d(2099, 3, 2)), Some(Some(app.early)));

    cleanup(&app);
}

#[tokio::test]
async fn an_automatic_write_the_guard_refuses_changes_nothing() {
    let app = app!();
    let state = state(&app);
    let anna = app.anna.id;
    let tomorrow = Local::now().date_naive() + chrono::Duration::days(1);

    // Inside the freeze window of a published month a change needs a reason, which
    // an unattended write does not have.
    app.roster(anna, tomorrow, Some(app.late));
    app.set_month(tomorrow, "published");
    let plan = vec![entry(anna, tomorrow, Some(app.early), "automated")];
    let refused = state.confirmed_shift_plan_repo.apply_automated_plan(&app.tenant, &[anna], tomorrow, tomorrow, plan, &ctx(false)).await;
    assert!(refused.is_err(), "a frozen day needs a reason");
    assert_eq!(app.roster_cell(anna, tomorrow), Some(Some(app.late)), "nothing was written");

    // A locked month is for admins only.
    app.roster(anna, d(2099, 3, 2), Some(app.late));
    app.set_month(d(2099, 3, 1), "locked");
    let plan = vec![entry(anna, d(2099, 3, 2), Some(app.early), "automated")];
    let refused = state.confirmed_shift_plan_repo.apply_automated_plan(&app.tenant, &[anna], d(2099, 3, 1), d(2099, 3, 31), plan, &ctx(false)).await;
    assert!(refused.is_err(), "a locked month is for admins");
    assert_eq!(app.roster_cell(anna, d(2099, 3, 2)), Some(Some(app.late)));
    assert!(app.notices().is_empty());

    cleanup(&app);
}

// ── starting a run ──────────────────────────────────────────────────────────

#[tokio::test]
async fn a_run_without_the_planner_ends_failed_with_the_reason_and_writes_nothing() {
    let app = app!();
    let state = state(&app); // no NATS client
    schedule_today(&app);

    shift::services::auto_plan::run_once(&state, Local::now().naive_local()).await;

    let (status, note) = outcome(&state, &app).await;
    assert_eq!(status.as_deref(), Some("failed"));
    assert!(note.unwrap().contains("not connected"));
    assert_eq!(audited(&app, "planner.auto_result"), 1);
    let mut conn = app.pool.get().unwrap();
    let rows: i64 = confirmed_shift_plans::table.filter(confirmed_shift_plans::tenant_id.eq(&app.tenant)).count().get_result(&mut conn).unwrap();
    assert_eq!(rows, 0);
    drop(conn);

    cleanup(&app);
}

#[tokio::test]
async fn two_ticks_on_one_day_start_one_run() {
    let app = app!();
    let state = state(&app);
    schedule_today(&app);

    let now = Local::now().naive_local();
    shift::services::auto_plan::run_once(&state, now).await;
    shift::services::auto_plan::run_once(&state, now).await;
    assert_eq!(audited(&app, "planner.auto_result"), 1, "the second tick finds the day claimed");

    cleanup(&app);
}

#[tokio::test]
async fn a_roster_that_already_reaches_the_end_is_skipped_with_the_date() {
    let app = app!();
    let state = state(&app);
    schedule_today(&app);
    app.roster(app.anna.id, d(2099, 3, 2), Some(app.early)); // far beyond any range

    shift::services::auto_plan::run_once(&state, Local::now().naive_local()).await;

    let (status, note) = outcome(&state, &app).await;
    assert_eq!(status.as_deref(), Some("skipped"));
    assert_eq!(note.as_deref(), Some("Already planned until 2099-03-02"));

    cleanup(&app);
}

// ── what a finished plan becomes ────────────────────────────────────────────

/// A task of the automatic planner for the test tenant, and its answer.
async fn answer(app: &TestApp, state: &AppState, message: Option<&str>, assigned: &[(Uuid, &str, Option<Uuid>)]) -> Uuid {
    let task = Uuid::new_v4();
    state.planning_task_repo.create_planning_task(&app.tenant, task, json!({}), "auto").await.unwrap();
    {
        let mut conn = app.pool.get().unwrap();
        diesel::update(planner_settings::table.filter(planner_settings::tenant_id.eq(&app.tenant)))
            .set((planner_settings::auto_plan_last_outcome.eq(Some("running")), planner_settings::auto_plan_last_task_id.eq(Some(task))))
            .execute(&mut conn)
            .ok();
    }
    let plans: Vec<_> = assigned
        .iter()
        .map(|(employee, date, shift)| {
            json!({
                "employee_id": employee.to_string(),
                "employee_name": "Anna",
                "daily_plan": [match shift {
                    Some(shift) => json!({ "date": date, "status": "assigned", "shift_id": shift.to_string() }),
                    None => json!({ "date": date, "status": "free" }),
                }],
            })
        })
        .collect();
    let payload = json!({
        "job_id": task.to_string(),
        "status": "optimal",
        "objective_value": 1.0,
        "planning_period": { "start_date": "2099-03-02", "end_date": "2099-03-08" },
        "message": message,
        "employee_plans": plans,
    });
    handle_result_message(state.clone(), &serde_json::to_vec(&payload).unwrap()).await.unwrap();
    task
}

#[tokio::test]
async fn a_clean_plan_in_draft_months_becomes_the_roster_and_the_month_stays_draft() {
    let app = app!();
    let state = state(&app);
    state.planner_settings_repo.get_or_create_planner_settings(&app.tenant).await.unwrap();

    answer(&app, &state, None, &[(app.anna.id, "2099-03-02", Some(app.early))]).await;

    assert_eq!(app.roster_cell(app.anna.id, d(2099, 3, 2)), Some(Some(app.early)));
    let (status, note) = outcome(&state, &app).await;
    assert_eq!(status.as_deref(), Some("taken_over"));
    assert_eq!(note.as_deref(), Some("Planned 2099-03-02 to 2099-03-08"));
    assert!(app.notices().is_empty(), "a draft month notifies nobody");
    let mut conn = app.pool.get().unwrap();
    let months: i64 = shift::schema::roster_months::table
        .filter(shift::schema::roster_months::tenant_id.eq(&app.tenant))
        .count()
        .get_result(&mut conn)
        .unwrap();
    assert_eq!(months, 0, "nothing was published");
    drop(conn);

    cleanup(&app);
}

#[tokio::test]
async fn a_plan_with_a_solver_message_stays_a_proposal() {
    let app = app!();
    let state = state(&app);
    state.planner_settings_repo.get_or_create_planner_settings(&app.tenant).await.unwrap();

    answer(&app, &state, Some("1 slot below minimum staffing"), &[(app.anna.id, "2099-03-02", Some(app.early))]).await;

    assert_eq!(app.roster_cell(app.anna.id, d(2099, 3, 2)), None, "the roster is untouched");
    let (status, note) = outcome(&state, &app).await;
    assert_eq!(status.as_deref(), Some("kept_as_proposal"));
    assert!(note.unwrap().contains("1 slot below minimum staffing"));

    cleanup(&app);
}

#[tokio::test]
async fn a_plan_into_a_published_month_stays_a_proposal() {
    let app = app!();
    let state = state(&app);
    state.planner_settings_repo.get_or_create_planner_settings(&app.tenant).await.unwrap();
    app.set_month(d(2099, 3, 1), "published");

    answer(&app, &state, None, &[(app.anna.id, "2099-03-02", Some(app.early))]).await;

    assert_eq!(app.roster_cell(app.anna.id, d(2099, 3, 2)), None);
    assert!(app.notices().is_empty(), "no change notice for a change nobody decided");
    let (status, note) = outcome(&state, &app).await;
    assert_eq!(status.as_deref(), Some("kept_as_proposal"));
    assert_eq!(note.as_deref(), Some("March 2099 is published"));

    cleanup(&app);
}

#[tokio::test]
async fn a_plan_on_a_recorded_absence_stays_a_proposal() {
    let app = app!();
    let state = state(&app);
    state.planner_settings_repo.get_or_create_planner_settings(&app.tenant).await.unwrap();
    app.roster(app.anna.id, d(2099, 3, 2), None);
    {
        let mut conn = app.pool.get().unwrap();
        diesel::update(confirmed_shift_plans::table.filter(confirmed_shift_plans::tenant_id.eq(&app.tenant)))
            .set((confirmed_shift_plans::absence_type.eq(Some("sick")), confirmed_shift_plans::creation_type.eq("manual")))
            .execute(&mut conn)
            .unwrap();
    }

    answer(&app, &state, None, &[(app.anna.id, "2099-03-02", Some(app.early))]).await;

    assert_eq!(app.roster_cell(app.anna.id, d(2099, 3, 2)), Some(None), "the sick day is as it was");
    let (status, note) = outcome(&state, &app).await;
    assert_eq!(status.as_deref(), Some("kept_as_proposal"));
    assert_eq!(note.as_deref(), Some("Anna is recorded as sick on 2099-03-02 but is planned"));

    cleanup(&app);
}

#[tokio::test]
async fn a_solver_error_marks_the_run_failed() {
    let app = app!();
    let state = state(&app);
    state.planner_settings_repo.get_or_create_planner_settings(&app.tenant).await.unwrap();
    let task = Uuid::new_v4();
    state.planning_task_repo.create_planning_task(&app.tenant, task, json!({}), "auto").await.unwrap();

    let payload = json!({ "job_id": task.to_string(), "status": "error", "message": "model invalid" });
    handle_result_message(state.clone(), &serde_json::to_vec(&payload).unwrap()).await.unwrap();

    let (status, note) = outcome(&state, &app).await;
    assert_eq!(status.as_deref(), Some("failed"));
    assert!(note.unwrap().contains("model invalid"));

    cleanup(&app);
}

#[tokio::test]
async fn a_manual_run_never_touches_the_automatic_outcome_or_the_roster() {
    let app = app!();
    let state = state(&app);
    state.planner_settings_repo.get_or_create_planner_settings(&app.tenant).await.unwrap();
    let task = Uuid::new_v4();
    state.planning_task_repo.create_planning_task(&app.tenant, task, json!({}), "manual").await.unwrap();
    let payload = json!({
        "job_id": task.to_string(), "status": "optimal", "objective_value": 1.0,
        "planning_period": { "start_date": "2099-03-02", "end_date": "2099-03-08" },
        "employee_plans": [{ "employee_id": app.anna.id.to_string(), "employee_name": "Anna",
            "daily_plan": [{ "date": "2099-03-02", "status": "assigned", "shift_id": app.early.to_string() }] }],
    });
    handle_result_message(state.clone(), &serde_json::to_vec(&payload).unwrap()).await.unwrap();

    assert_eq!(app.roster_cell(app.anna.id, d(2099, 3, 2)), None);
    assert_eq!(outcome(&state, &app).await, (None, None));

    cleanup(&app);
}
