//! End-to-end tests for roster writes under the month lifecycle: manual edits,
//! Take as Plan and absences follow the month's status (locked → admin with a
//! reason, freeze window → reason, published → tracked as notices), and
//! viewers do not see draft months.

mod common;
mod roster_support;

use chrono::{Duration, NaiveDate};
use diesel::prelude::*;
use serde_json::{json, Value};
use uuid::Uuid;

use roster_support::{day, first_of, TestApp};
use shift::models::NewOptimizedShiftResult;
use shift::schema::{optimized_shift_results, unavailabilities};

macro_rules! app {
    () => {
        match TestApp::spawn("roster-lifecycle").await {
            Some(app) => app,
            None => return,
        }
    };
}

/// The `n`th day (1-based) of next month — always beyond a 7-day freeze window.
fn next_month_day(n: i64) -> NaiveDate {
    first_of(first_of(day(0)) + Duration::days(40)) + Duration::days(n - 1)
}

/// A day of last month, which reads as locked once published.
fn last_month_day() -> NaiveDate {
    first_of(day(0)) - Duration::days(3)
}

// ---------------------------------------------------------------------------
// Manual edits
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_planner_may_not_edit_a_locked_month() {
    let app = app!();
    let date = last_month_day();
    app.set_month(date, "published"); // over: locked
    let id = app.roster(app.anna.id, date, Some(app.early));

    let (status, body) = app.put(&format!("/confirmed-shift-plans/{id}"), &app.planner(), json!({ "shift_id": app.late }), Some("fix")).await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(app.roster_cell(app.anna.id, date), Some(Some(app.early)), "unchanged");

    let (status, body) = app.put(&format!("/confirmed-shift-plans/{id}"), &app.admin(), json!({ "shift_id": app.late }), None).await;
    assert_eq!(status, 428, "an admin needs a reason: {body}");
    let (status, body) = app.put(&format!("/confirmed-shift-plans/{id}"), &app.admin(), json!({ "shift_id": app.late }), Some("Payroll correction")).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(app.roster_cell(app.anna.id, date), Some(Some(app.late)));
    let notices = app.notices();
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].3.as_deref(), Some("Payroll correction"));

    app.cleanup();
}

#[tokio::test]
async fn a_change_inside_the_freeze_window_needs_a_reason_and_becomes_a_notice() {
    let app = app!();
    let tomorrow = day(1);
    app.set_month(tomorrow, "published");
    let id = app.roster(app.anna.id, tomorrow, Some(app.early));
    let path = format!("/confirmed-shift-plans/{id}");

    let (status, body) = app.put(&path, &app.planner(), json!({ "shift_id": app.late }), None).await;
    assert_eq!(status, 428, "{body}");
    assert_eq!(body["code"], "reason_required");
    assert!(app.notices().is_empty());

    let (status, body) = app.put(&path, &app.planner(), json!({ "shift_id": app.late }), Some("Krankmeldung Müller")).await;
    assert_eq!(status, 200, "{body}");
    let notices = app.notices();
    assert_eq!(notices.len(), 1);
    let (employee, date, source, reason, before, after) = &notices[0];
    assert_eq!((*employee, *date, source.as_str()), (app.anna.id, tomorrow, "manual"));
    assert_eq!(reason.as_deref(), Some("Krankmeldung Müller"), "URL-decoded");
    assert_eq!(before.as_ref().unwrap()["shift_id"], json!(app.early));
    assert_eq!(after.as_ref().unwrap()["shift_id"], json!(app.late));

    app.cleanup();
}

#[tokio::test]
async fn a_draft_month_is_edited_silently_and_a_published_one_beyond_the_window_without_a_reason() {
    let app = app!();
    let date = next_month_day(12);
    let id = app.roster(app.anna.id, date, Some(app.early));

    let (status, _) = app.put(&format!("/confirmed-shift-plans/{id}"), &app.planner(), json!({ "shift_id": app.late }), None).await;
    assert_eq!(status, 200);
    assert!(app.notices().is_empty(), "draft: no notice");

    app.set_month(date, "published");
    let (status, _) = app.delete(&format!("/confirmed-shift-plans/{id}"), &app.planner(), None).await;
    assert_eq!(status, 200);
    let notices = app.notices();
    assert_eq!(notices.len(), 1, "the deletion is a change");
    assert_eq!(notices[0].5, None, "after: no entry");

    app.cleanup();
}

// ---------------------------------------------------------------------------
// Take as Plan
// ---------------------------------------------------------------------------

/// Stores a proposal covering `days` for Anna and Ben, each day `(anna, ben)`
/// as `Some(shift)` or a free day.
fn proposal(app: &TestApp, days: &[(NaiveDate, Option<Uuid>, Option<Uuid>)]) -> Uuid {
    let entry = |date: NaiveDate, shift: Option<Uuid>| match shift {
        Some(s) => json!({ "date": date, "status": "assigned", "shift_id": s }),
        None => json!({ "date": date, "status": "free" }),
    };
    let plan = |id: Uuid, name: &str, pick: &dyn Fn(&(NaiveDate, Option<Uuid>, Option<Uuid>)) -> Option<Uuid>| {
        json!({
            "employee_id": id,
            "employee_name": name,
            "daily_plan": days.iter().map(|d| entry(d.0, pick(d))).collect::<Vec<Value>>(),
        })
    };
    let result = json!({
        "status": "optimal",
        "planning_period": { "start_date": days.first().unwrap().0, "end_date": days.last().unwrap().0 },
        "employee_plans": [
            plan(app.anna.id, "Anna", &|d| d.1),
            plan(app.ben.id, "Ben", &|d| d.2),
        ],
        "message": null,
    });
    let mut conn = app.pool.get().unwrap();
    diesel::insert_into(optimized_shift_results::table)
        .values(NewOptimizedShiftResult { result, tenant_id: app.tenant.clone() })
        .returning(optimized_shift_results::id)
        .get_result(&mut conn)
        .unwrap()
}

fn drop_proposals(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    let _ = diesel::delete(optimized_shift_results::table.filter(optimized_shift_results::tenant_id.eq(&app.tenant))).execute(&mut conn);
}

#[tokio::test]
async fn retaking_a_plan_into_a_published_month_notifies_only_the_days_that_differ() {
    let app = app!();
    let (d1, d2, d3) = (next_month_day(10), next_month_day(11), next_month_day(12));
    let (e, l) = (Some(app.early), Some(app.late));
    // The published roster…
    for (date, anna, ben) in [(d1, e, l), (d2, e, l), (d3, None, e)] {
        app.roster(app.anna.id, date, anna);
        app.roster(app.ben.id, date, ben);
    }
    app.set_month(d1, "published");
    // …and a proposal that differs on three employee-days.
    let id = proposal(&app, &[(d1, e, l), (d2, l, e), (d3, e, e)]);
    let path = format!("/planner/optimized-shifts/{id}/take-as-plan");

    let (status, body) = app.post(&path, &app.planner(), Some(json!({ "dry_run": true })), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["changes"], 3, "{body}");
    assert_eq!(body["dry_run"], true);
    assert!(app.notices().is_empty(), "a dry run writes nothing");
    assert_eq!(app.roster_cell(app.anna.id, d2), Some(e), "and changes nothing");

    let (status, body) = app.post(&path, &app.planner(), Some(json!({})), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["changes"], 3);
    let notices = app.notices();
    assert_eq!(notices.len(), 3, "{notices:?}");
    assert!(notices.iter().all(|n| n.2 == "take_as_plan"));
    let mut cells: Vec<(Uuid, NaiveDate)> = notices.iter().map(|n| (n.0, n.1)).collect();
    cells.sort();
    let mut expected = vec![(app.anna.id, d2), (app.ben.id, d2), (app.anna.id, d3)];
    expected.sort();
    assert_eq!(cells, expected);

    drop_proposals(&app);
    app.cleanup();
}

#[tokio::test]
async fn taking_a_plan_into_a_draft_month_writes_no_notices() {
    let app = app!();
    let d1 = next_month_day(10);
    app.roster(app.anna.id, d1, Some(app.early));
    let id = proposal(&app, &[(d1, Some(app.late), None)]);

    let (status, body) = app.post(&format!("/planner/optimized-shifts/{id}/take-as-plan"), &app.planner(), Some(json!({})), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["changes"], 0);
    assert_eq!(app.roster_cell(app.anna.id, d1), Some(Some(app.late)));
    assert!(app.notices().is_empty());

    drop_proposals(&app);
    app.cleanup();
}

#[tokio::test]
async fn taking_a_plan_that_touches_a_locked_month_is_refused() {
    let app = app!();
    let date = last_month_day();
    app.set_month(date, "published"); // over: locked
    app.roster(app.anna.id, date, Some(app.early));
    let id = proposal(&app, &[(date, Some(app.late), Some(app.late))]);

    let (status, body) = app.post(&format!("/planner/optimized-shifts/{id}/take-as-plan"), &app.planner(), Some(json!({})), None).await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(app.roster_cell(app.anna.id, date), Some(Some(app.early)), "unchanged");
    assert_eq!(app.roster_cell(app.ben.id, date), None);

    drop_proposals(&app);
    app.cleanup();
}

// ---------------------------------------------------------------------------
// Absences (unavailability mirrored into the roster)
// ---------------------------------------------------------------------------

fn unavailability_count(app: &TestApp) -> i64 {
    let mut conn = app.pool.get().unwrap();
    unavailabilities::table
        .filter(unavailabilities::tenant_id.eq(&app.tenant))
        .count()
        .get_result(&mut conn)
        .unwrap()
}

#[tokio::test]
async fn an_absence_and_its_roster_entry_are_refused_or_written_together() {
    let app = app!();
    let tomorrow = day(1);
    app.set_month(tomorrow, "published");
    app.roster(app.anna.id, tomorrow, Some(app.early));
    let body = json!({ "employee_id": app.anna.id, "unavailable_date": tomorrow });

    let (status, response) = app.post("/unavailabilities", &app.planner(), Some(body.clone()), None).await;
    assert_eq!(status, 428, "{response}");
    assert_eq!(unavailability_count(&app), 0, "no unavailability without its roster entry");
    assert_eq!(app.roster_cell(app.anna.id, tomorrow), Some(Some(app.early)));

    let (status, response) = app.post("/unavailabilities", &app.planner(), Some(body), Some("Called in sick")).await;
    assert_eq!(status, 200, "{response}");
    assert_eq!(unavailability_count(&app), 1);
    assert_eq!(app.roster_cell(app.anna.id, tomorrow), Some(None), "the shift became an absence");
    let notices = app.notices();
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].2, "absence");

    // Taking it back follows the same rules.
    let id = response["id"].as_str().unwrap();
    let (status, _) = app.delete(&format!("/unavailabilities/{id}"), &app.planner(), None).await;
    assert_eq!(status, 428);
    assert_eq!(unavailability_count(&app), 1, "still there");
    let (status, _) = app.delete(&format!("/unavailabilities/{id}"), &app.planner(), Some("Recovered")).await;
    assert_eq!(status, 200);
    assert_eq!(unavailability_count(&app), 0);
    assert_eq!(app.notices().len(), 2);

    app.cleanup();
}

#[tokio::test]
async fn an_absence_in_a_locked_month_is_refused_for_a_planner() {
    let app = app!();
    let date = last_month_day();
    app.set_month(date, "published"); // over: locked
    let body = json!({ "employee_id": app.anna.id, "unavailable_date": date });

    let (status, _) = app.post("/unavailabilities", &app.planner(), Some(body), Some("late note")).await;
    assert_eq!(status, 403);
    assert_eq!(unavailability_count(&app), 0);
    assert_eq!(app.roster_cell(app.anna.id, date), None);

    app.cleanup();
}

// ---------------------------------------------------------------------------
// Draft visibility
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_viewer_sees_no_draft_month_and_a_planner_sees_everything() {
    let app = app!();
    let published = next_month_day(5);
    let draft = first_of(published + Duration::days(40)) + Duration::days(4); // the month after
    app.set_month(published, "published");
    app.roster(app.anna.id, published, Some(app.early));
    let draft_id = app.roster(app.anna.id, draft, Some(app.late));
    let range = format!("from_date={}&to_date={}", published, draft);

    let dates = |body: &Value, key: Option<&str>| -> Vec<String> {
        let list = match key { Some(k) => &body[k], None => body };
        list.as_array().unwrap().iter().map(|r| r["date"].as_str().unwrap().to_string()).collect()
    };

    let viewer = app.viewer(&app.anna);
    let (status, body) = app.get(&format!("/confirmed-shift-plans?{range}"), &viewer).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(dates(&body, Some("data")), vec![published.to_string()]);
    assert_eq!(body["total"], 1, "the count leaves the draft out too");

    let (_, body) = app.get(&format!("/employees/{}/confirmed-shift-plans?{range}", app.anna.id), &viewer).await;
    assert_eq!(dates(&body, None), vec![published.to_string()]);
    let (_, body) = app.get(&format!("/employees/{}/confirmed-shift-plans", app.anna.id), &viewer).await;
    assert_eq!(dates(&body, None), vec![published.to_string()], "also without a range");
    let (status, _) = app.get(&format!("/confirmed-shift-plans/{draft_id}"), &viewer).await;
    assert_eq!(status, 404, "a draft entry is not found for a viewer");

    let (_, body) = app.get(&format!("/confirmed-shift-plans?{range}"), &app.planner()).await;
    assert_eq!(dates(&body, Some("data")), vec![published.to_string(), draft.to_string()]);
    let (status, _) = app.get(&format!("/confirmed-shift-plans/{draft_id}"), &app.planner()).await;
    assert_eq!(status, 200);

    app.cleanup();
}

// ---------------------------------------------------------------------------
// Change notices
// ---------------------------------------------------------------------------

/// Two changes for Anna and one for Ben in a published month, by a planner.
async fn three_changes(app: &TestApp) -> (NaiveDate, NaiveDate) {
    let (d1, d2) = (next_month_day(10), next_month_day(11));
    app.set_month(d1, "published");
    for (who, date) in [(app.anna.id, d1), (app.anna.id, d2), (app.ben.id, d1)] {
        let (status, body) = app.post(
            &format!("/employees/{who}/confirmed-shift-plans"),
            &app.planner(),
            Some(json!({ "date": date, "shift_id": app.early })),
            None,
        ).await;
        assert_eq!(status, 200, "{body}");
    }
    (d1, d2)
}

#[tokio::test]
async fn an_employee_sees_and_counts_only_their_own_notices() {
    let app = app!();
    three_changes(&app).await;

    let (status, list) = app.get("/roster-change-notices", &app.viewer(&app.anna)).await;
    assert_eq!(status, 200, "{list}");
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 2, "only Anna's");
    assert!(list.iter().all(|n| n["employee_id"] == json!(app.anna.id)));
    assert_eq!(list[0]["after"]["shift_name"], "Early", "names are resolved");
    assert_eq!(list[0]["employee_name"], "Anna");

    // Asking for Ben's does not help a viewer.
    let (_, list) = app.get(&format!("/roster-change-notices?employee_id={}", app.ben.id), &app.viewer(&app.anna)).await;
    assert_eq!(list.as_array().unwrap().len(), 2, "still only her own");

    let (_, count) = app.get("/roster-change-notices/unread-count", &app.viewer(&app.anna)).await;
    assert_eq!(count["count"], 2);
    let (_, count) = app.get("/roster-change-notices/unread-count", &app.planner()).await;
    assert_eq!(count["count"], 0, "a planner who is no employee has none of their own");

    app.cleanup();
}

#[tokio::test]
async fn notices_are_acknowledged_by_their_employee_only() {
    let app = app!();
    three_changes(&app).await;

    let (_, bens) = app.get("/roster-change-notices", &app.viewer(&app.ben)).await;
    let bens_id = bens[0]["id"].clone();
    let (status, _) = app.post("/roster-change-notices/acknowledge", &app.viewer(&app.anna), Some(json!({ "ids": [bens_id] })), None).await;
    assert_eq!(status, 403, "Anna may not acknowledge Ben's");
    let (status, _) = app.post("/roster-change-notices/acknowledge", &app.planner(), Some(json!({ "ids": [bens_id] })), None).await;
    assert_eq!(status, 403, "nor may a planner on his behalf");
    let (_, count) = app.get("/roster-change-notices/unread-count", &app.viewer(&app.ben)).await;
    assert_eq!(count["count"], 1);

    let (_, annas) = app.get("/roster-change-notices", &app.viewer(&app.anna)).await;
    let (status, body) = app.post("/roster-change-notices/acknowledge", &app.viewer(&app.anna), Some(json!({ "ids": [annas[0]["id"]] })), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["acknowledged"], 1);
    let (status, body) = app.post("/roster-change-notices/acknowledge", &app.viewer(&app.anna), None, None).await;
    assert_eq!(status, 200, "no body: all of hers — {body}");
    assert_eq!(body["acknowledged"], 1);
    let (_, count) = app.get("/roster-change-notices/unread-count", &app.viewer(&app.anna)).await;
    assert_eq!(count["count"], 0);
    let (_, annas) = app.get("/roster-change-notices", &app.viewer(&app.anna)).await;
    assert!(annas.as_array().unwrap().iter().all(|n| n["acknowledged_at"].is_string()), "each keeps its time");

    app.cleanup();
}

#[tokio::test]
async fn a_planner_lists_unacknowledged_notices_for_a_day() {
    let app = app!();
    let (d1, _) = three_changes(&app).await;
    app.post("/roster-change-notices/acknowledge", &app.viewer(&app.ben), None, None).await;

    let (status, list) = app.get(&format!("/roster-change-notices?from_date={d1}&to_date={d1}&acknowledged=false"), &app.planner()).await;
    assert_eq!(status, 200, "{list}");
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 1, "Ben's is acknowledged, Anna's second is another day: {list:?}");
    assert_eq!(list[0]["employee_name"], "Anna");

    let (_, all) = app.get("/roster-change-notices", &app.planner()).await;
    assert_eq!(all.as_array().unwrap().len(), 3, "a planner sees everyone's");

    app.cleanup();
}

#[tokio::test]
async fn a_notice_outlives_later_changes_to_its_entry() {
    let app = app!();
    let date = next_month_day(10);
    app.set_month(date, "published");
    let id = app.roster(app.anna.id, date, Some(app.early));
    app.put(&format!("/confirmed-shift-plans/{id}"), &app.planner(), json!({ "shift_id": app.late }), None).await;
    app.delete(&format!("/confirmed-shift-plans/{id}"), &app.planner(), None).await;

    let notices = app.notices();
    assert_eq!(notices.len(), 2, "one per step");
    assert_eq!(notices[0].4.as_ref().unwrap()["shift_id"], json!(app.early));
    assert_eq!(notices[0].5.as_ref().unwrap()["shift_id"], json!(app.late));
    assert_eq!(notices[1].4.as_ref().unwrap()["shift_id"], json!(app.late));
    assert_eq!(notices[1].5, None);

    app.cleanup();
}
