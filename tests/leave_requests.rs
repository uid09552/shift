//! End-to-end tests for leave requests (`/leave-requests`, `/leave-blackouts`,
//! `/leave-limits`): who may request and decide, what approval does to the
//! absences and the roster (under the roster guard), blackout periods that refuse
//! a request, limits that only warn, and that pending leave reaches the
//! optimizer as a soft preference.
//!
//! Like the other suites these drive the real router over HTTP against a real
//! database, with signed tokens. Needs PostgreSQL (`DATABASE_URL`, or the
//! development default); without one the tests print a notice and pass.

mod common;
mod roster_support;

use chrono::NaiveDate;
use diesel::prelude::*;
use serde_json::{json, Value};
use uuid::Uuid;

use roster_support::{day, TestApp};
use shift::models::NewConfirmedShiftPlan;
use shift::schema::{
    audit_logs, capabilities, confirmed_shift_plans, employee_capabilities, roster_change_notices, unavailabilities,
    workstations,
};
use shift::services::optimizer::OptimizerService;

macro_rules! app {
    () => {
        match TestApp::spawn("leave").await {
            Some(app) => app,
            None => return,
        }
    };
}

fn text(date: NaiveDate) -> String {
    date.to_string()
}

fn request_body(who: Uuid, from: i64, to: i64) -> Value {
    json!({ "employee_id": who, "start_date": text(day(from)), "end_date": text(day(to)), "note": "Holiday" })
}

/// How many hard whole-day unavailabilities `employee` has, between two day offsets.
fn absences(app: &TestApp, employee: Uuid, from: i64, to: i64) -> i64 {
    let mut conn = app.pool.get().unwrap();
    unavailabilities::table
        .filter(unavailabilities::employee_id.eq(employee))
        .filter(unavailabilities::unavailable_date.between(day(from), day(to)))
        .filter(unavailabilities::is_soft_preference.eq(false))
        .count()
        .get_result(&mut conn)
        .unwrap()
}

/// The `absence_type` of `employee`'s roster row on a day: `None` for no row.
fn roster_absence(app: &TestApp, employee: Uuid, offset: i64) -> Option<Option<String>> {
    let mut conn = app.pool.get().unwrap();
    confirmed_shift_plans::table
        .filter(confirmed_shift_plans::tenant_id.eq(&app.tenant))
        .filter(confirmed_shift_plans::employee_id.eq(employee))
        .filter(confirmed_shift_plans::date.eq(day(offset)))
        .select(confirmed_shift_plans::absence_type)
        .first(&mut conn)
        .optional()
        .unwrap()
}

async fn request(app: &TestApp, who: &roster_support::Person, from: i64, to: i64) -> Value {
    let (status, body) = app.post("/leave-requests", &app.viewer(who), Some(request_body(who.id, from, to)), None).await;
    assert_eq!(status, 200, "{body}");
    body
}

fn id_of(body: &Value) -> String {
    body["id"].as_str().expect("id").to_string()
}

#[tokio::test]
async fn an_employee_requests_leave_for_themselves_only() {
    let app = app!();

    let created = request(&app, &app.anna, 30, 32).await;
    assert_eq!(created["status"], "pending");
    assert_eq!(created["employee_id"], app.anna.id.to_string());
    assert_eq!(created["warnings"], json!([]));
    assert!(created.get("tenant_id").is_none(), "the tenant stays internal");

    let (status, _) = app.post("/leave-requests", &app.viewer(&app.anna), Some(request_body(app.ben.id, 40, 41)), None).await;
    assert_eq!(status, 403, "not on someone else's behalf");
    let (status, _) = app.post("/leave-requests", &app.planner(), Some(request_body(app.anna.id, 40, 41)), None).await;
    assert_eq!(status, 403, "a planner decides, an employee requests");

    let token = app.viewer(&app.anna);
    let backwards = request_body(app.anna.id, 45, 44);
    assert_eq!(app.post("/leave-requests", &token, Some(backwards), None).await.0, 400, "end before start");
    let past = request_body(app.anna.id, -2, 3);
    assert_eq!(app.post("/leave-requests", &token, Some(past), None).await.0, 400, "already started");
    let too_long = request_body(app.anna.id, 10, 400);
    assert_eq!(app.post("/leave-requests", &token, Some(too_long), None).await.0, 400, "more than a year");

    let overlap = request_body(app.anna.id, 32, 34);
    let (status, body) = app.post("/leave-requests", &token, Some(overlap), None).await;
    assert_eq!(status, 409, "{body}");
    app.cleanup();
}

#[tokio::test]
async fn viewers_see_only_their_own_requests_and_planners_see_all() {
    let app = app!();
    let created = request(&app, &app.anna, 30, 31).await;
    let id = id_of(&created);

    let (_, own) = app.get("/leave-requests", &app.viewer(&app.anna)).await;
    assert_eq!(own.as_array().unwrap().len(), 1);
    let (_, others) = app.get("/leave-requests", &app.viewer(&app.ben)).await;
    assert_eq!(others, json!([]), "Ben has nothing and sees nothing of Anna's");
    assert_eq!(app.get(&format!("/leave-requests/{id}"), &app.viewer(&app.ben)).await.0, 404);
    assert_eq!(app.get(&format!("/leave-requests/{id}"), &app.viewer(&app.anna)).await.0, 200);

    let (_, all) = app.get("/leave-requests?status=pending", &app.planner()).await;
    assert_eq!(all.as_array().unwrap().len(), 1);
    let (_, none) = app.get("/leave-requests?status=approved", &app.planner()).await;
    assert_eq!(none, json!([]));

    let (status, count) = app.get("/leave-requests/pending-count", &app.planner()).await;
    assert_eq!((status, count["count"].as_i64()), (200, Some(1)));
    assert_eq!(app.get("/leave-requests/pending-count", &app.viewer(&app.anna)).await.0, 403);
    app.cleanup();
}

#[tokio::test]
async fn a_blackout_refuses_a_request_that_touches_it() {
    let app = app!();
    let blackout = json!({ "start_date": text(day(40)), "end_date": text(day(45)), "reason": "Christmas rush" });

    assert_eq!(app.post("/leave-blackouts", &app.viewer(&app.anna), Some(blackout.clone()), None).await.0, 403);
    let (status, created) = app.post("/leave-blackouts", &app.planner(), Some(blackout), None).await;
    assert_eq!(status, 200, "{created}");
    let backwards = json!({ "start_date": text(day(50)), "end_date": text(day(49)) });
    assert_eq!(app.post("/leave-blackouts", &app.planner(), Some(backwards), None).await.0, 400);

    let (status, list) = app.get("/leave-blackouts", &app.viewer(&app.anna)).await;
    assert_eq!((status, list.as_array().map(Vec::len)), (200, Some(1)), "everyone sees them, the form needs them");

    let token = app.viewer(&app.anna);
    let (status, body) = app.post("/leave-requests", &token, Some(request_body(app.anna.id, 44, 46)), None).await;
    assert_eq!(status, 400, "{body}");
    assert!(body["error"].as_str().unwrap().contains("Christmas rush"), "{body}");
    assert_eq!(app.post("/leave-requests", &token, Some(request_body(app.anna.id, 46, 47)), None).await.0, 200, "just after");

    let id = created["id"].as_str().unwrap();
    assert_eq!(app.delete(&format!("/leave-blackouts/{id}"), &app.viewer(&app.anna), None).await.0, 403);
    assert_eq!(app.delete(&format!("/leave-blackouts/{id}"), &app.planner(), None).await.0, 200);
    assert_eq!(app.delete(&format!("/leave-blackouts/{id}"), &app.planner(), None).await.0, 404, "gone");
    assert_eq!(app.post("/leave-requests", &token, Some(request_body(app.anna.id, 44, 45)), None).await.0, 200, "lifted");
    app.cleanup();
}

#[tokio::test]
async fn approving_writes_absences_and_revoking_takes_them_back() {
    let app = app!();
    app.roster(app.anna.id, day(31), Some(app.early));
    let id = id_of(&request(&app, &app.anna, 30, 32).await);

    assert_eq!(absences(&app, app.anna.id, 30, 32), 0, "nothing is written while pending");
    assert_eq!(app.post(&format!("/leave-requests/{id}/approve"), &app.viewer(&app.anna), Some(json!({})), None).await.0, 403);

    let (status, body) = app.post(&format!("/leave-requests/{id}/approve"), &app.planner(), Some(json!({ "comment": "Enjoy" })), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["status"], "approved");
    assert_eq!(body["decision_comment"], "Enjoy");
    assert_eq!(absences(&app, app.anna.id, 30, 32), 3, "one per day");
    for offset in 30..=32 {
        assert_eq!(roster_absence(&app, app.anna.id, offset), Some(Some("unavailable".into())), "day {offset}");
    }
    assert_eq!(app.roster_cell(app.anna.id, day(31)), Some(None), "the planned shift made way");

    let (status, _) = app.post(&format!("/leave-requests/{id}/approve"), &app.planner(), Some(json!({})), None).await;
    assert_eq!(status, 409, "decided once");
    assert_eq!(app.post(&format!("/leave-requests/{id}/cancel"), &app.viewer(&app.anna), None, None).await.0, 409, "no longer pending");

    let (status, revoked) = app.post(&format!("/leave-requests/{id}/revoke"), &app.planner(), Some(json!({ "comment": "Staff shortage" })), None).await;
    assert_eq!(status, 200, "{revoked}");
    assert_eq!(revoked["status"], "revoked");
    assert_eq!(absences(&app, app.anna.id, 30, 32), 0);
    for offset in 30..=32 {
        assert_eq!(roster_absence(&app, app.anna.id, offset), None, "day {offset}");
    }
    assert_eq!(app.post(&format!("/leave-requests/{id}/revoke"), &app.planner(), Some(json!({})), None).await.0, 409);

    let mut conn = app.pool.get().unwrap();
    let actions: Vec<String> = audit_logs::table
        .filter(audit_logs::tenant_id.eq(&app.tenant))
        .filter(audit_logs::entity_type.eq("leave_request"))
        .order(audit_logs::created_at.asc())
        .select(audit_logs::action)
        .load(&mut conn)
        .unwrap();
    assert_eq!(actions, vec!["leave_request.create", "leave_request.approve", "leave_request.revoke"]);
    drop(conn);
    app.cleanup();
}

#[tokio::test]
async fn approval_leaves_other_absences_alone() {
    let app = app!();
    // A sick day on the 31st, and a hand-entered absence on the 30th.
    {
        let mut conn = app.pool.get().unwrap();
        diesel::insert_into(confirmed_shift_plans::table)
            .values(NewConfirmedShiftPlan {
                employee_id: app.anna.id,
                shift_id: None,
                workstation_id: None,
                date: day(31),
                is_present: false,
                absence_type: Some("sick".into()),
                creation_type: "manual".into(),
                tenant_id: app.tenant.clone(),
            })
            .execute(&mut conn)
            .unwrap();
    }
    let (status, _) = app
        .post("/unavailabilities", &app.planner(), Some(json!({ "employee_id": app.anna.id, "unavailable_date": text(day(30)) })), None)
        .await;
    assert_eq!(status, 200);

    let id = id_of(&request(&app, &app.anna, 30, 32).await);
    assert_eq!(app.post(&format!("/leave-requests/{id}/approve"), &app.planner(), Some(json!({})), None).await.0, 200);
    assert_eq!(absences(&app, app.anna.id, 30, 32), 3, "the 30th was already absent and stays one; the 31st and 32nd are new");
    assert_eq!(roster_absence(&app, app.anna.id, 31), Some(Some("sick".into())), "sick stays sick");

    assert_eq!(app.post(&format!("/leave-requests/{id}/revoke"), &app.planner(), Some(json!({})), None).await.0, 200);
    assert_eq!(absences(&app, app.anna.id, 30, 32), 1, "only the hand-entered one is left");
    assert_eq!(roster_absence(&app, app.anna.id, 31), Some(Some("sick".into())), "revoke never touches it");
    assert_eq!(roster_absence(&app, app.anna.id, 30), Some(Some("unavailable".into())));
    app.cleanup();
}

#[tokio::test]
async fn rejecting_and_cancelling_change_nothing_in_the_roster() {
    let app = app!();
    let first = id_of(&request(&app, &app.anna, 30, 31).await);
    let second = id_of(&request(&app, &app.anna, 35, 36).await);

    let (status, body) = app.post(&format!("/leave-requests/{first}/reject"), &app.planner(), Some(json!({ "comment": "Too many away" })), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!((body["status"].as_str(), body["decision_comment"].as_str()), (Some("rejected"), Some("Too many away")));

    assert_eq!(app.post(&format!("/leave-requests/{second}/cancel"), &app.viewer(&app.ben), None, None).await.0, 403, "not Ben's");
    assert_eq!(app.post(&format!("/leave-requests/{second}/cancel"), &app.planner(), None, None).await.0, 403, "nor a planner's");
    let (status, body) = app.post(&format!("/leave-requests/{second}/cancel"), &app.viewer(&app.anna), None, None).await;
    assert_eq!((status, body["status"].as_str()), (200, Some("cancelled")));

    assert_eq!(absences(&app, app.anna.id, 30, 36), 0);
    assert_eq!(roster_absence(&app, app.anna.id, 30), None);
    // The dates are free to ask for again once a request is no longer pending or approved.
    assert_eq!(app.post("/leave-requests", &app.viewer(&app.anna), Some(request_body(app.anna.id, 30, 31)), None).await.0, 200);
    app.cleanup();
}

#[tokio::test]
async fn approval_in_a_published_month_follows_the_roster_guard() {
    let app = app!();
    app.set_month(day(1), "published");
    app.set_month(day(2), "published");
    let id = id_of(&request(&app, &app.anna, 1, 2).await);

    let (status, body) = app.post(&format!("/leave-requests/{id}/approve"), &app.planner(), Some(json!({})), None).await;
    assert_eq!(status, 428, "inside the freeze window a reason is needed: {body}");
    assert_eq!(body["code"], "reason_required");
    assert_eq!(absences(&app, app.anna.id, 1, 2), 0, "nothing was written");
    let (_, still) = app.get(&format!("/leave-requests/{id}"), &app.planner()).await;
    assert_eq!(still["status"], "pending", "and the request is still open");

    let (status, body) = app.post(&format!("/leave-requests/{id}/approve"), &app.planner(), Some(json!({})), Some("Agreed on the phone")).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(absences(&app, app.anna.id, 1, 2), 2);

    let mut conn = app.pool.get().unwrap();
    let notices: Vec<(NaiveDate, String, Option<String>)> = roster_change_notices::table
        .filter(roster_change_notices::tenant_id.eq(&app.tenant))
        .filter(roster_change_notices::employee_id.eq(app.anna.id))
        .order(roster_change_notices::date.asc())
        .select((roster_change_notices::date, roster_change_notices::source, roster_change_notices::reason))
        .load(&mut conn)
        .unwrap();
    assert_eq!(
        notices,
        vec![
            (day(1), "absence".to_string(), Some("Agreed on the phone".to_string())),
            (day(2), "absence".to_string(), Some("Agreed on the phone".to_string())),
        ],
        "Anna is told, with the reason"
    );
    drop(conn);
    app.cleanup();
}

/// A capability both people hold, and the cleanup of it.
fn give_capability(app: &TestApp, people: &[Uuid]) -> Uuid {
    let mut conn = app.pool.get().unwrap();
    let skill: Uuid = diesel::insert_into(capabilities::table)
        .values((capabilities::name.eq("Intensive Care"), capabilities::tenant_id.eq(&app.tenant)))
        .returning(capabilities::id)
        .get_result(&mut conn)
        .unwrap();
    for person in people {
        diesel::insert_into(employee_capabilities::table)
            .values((
                employee_capabilities::employee_id.eq(person),
                employee_capabilities::capability_id.eq(skill),
                employee_capabilities::tenant_id.eq(&app.tenant),
            ))
            .execute(&mut conn)
            .unwrap();
    }
    skill
}

fn drop_capabilities(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    let _ = diesel::delete(employee_capabilities::table.filter(employee_capabilities::tenant_id.eq(&app.tenant))).execute(&mut conn);
    let _ = diesel::delete(capabilities::table.filter(capabilities::tenant_id.eq(&app.tenant))).execute(&mut conn);
}

#[tokio::test]
async fn a_limit_warns_whoever_asks_and_decides_but_never_blocks() {
    let app = app!();
    let skill = give_capability(&app, &[app.anna.id, app.ben.id]);

    let limits = json!({ "limits": [{ "capability_id": skill, "max_absent": 1 }] });
    assert_eq!(app.put("/leave-limits", &app.viewer(&app.anna), limits.clone(), None).await.0, 403);
    assert_eq!(app.get("/leave-limits", &app.viewer(&app.anna)).await.0, 403);
    let unknown = json!({ "limits": [{ "capability_id": Uuid::new_v4(), "max_absent": 1 }] });
    assert_eq!(app.put("/leave-limits", &app.planner(), unknown, None).await.0, 400);
    let (status, saved) = app.put("/leave-limits", &app.planner(), limits, None).await;
    assert_eq!((status, saved.as_array().map(Vec::len)), (200, Some(1)), "{saved}");

    // Ben is off on the 30th.
    let ben = id_of(&request(&app, &app.ben, 30, 30).await);
    let (status, body) = app.post(&format!("/leave-requests/{ben}/approve"), &app.planner(), Some(json!({})), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["status"], "approved", "the first absence is within the limit");

    // Anna asks for the 30th to the 31st: the 30th would be a second absence.
    let created = request(&app, &app.anna, 30, 31).await;
    let warnings = created["warnings"].as_array().unwrap();
    assert_eq!(warnings.len(), 1, "{created}");
    assert_eq!(warnings[0]["capability"], "Intensive Care");
    assert_eq!(warnings[0]["max_absent"], 1);
    assert_eq!(warnings[0]["dates"], json!([text(day(30))]), "only the 30th, not the 31st");

    let id = id_of(&created);
    let (_, seen) = app.get(&format!("/leave-requests/{id}"), &app.planner()).await;
    assert_eq!(seen["warnings"], created["warnings"], "the planner sees the same");
    let (status, body) = app.post(&format!("/leave-requests/{id}/approve"), &app.planner(), Some(json!({})), None).await;
    assert_eq!(status, 200, "a limit never blocks: {body}");

    let mut conn = app.pool.get().unwrap();
    let audited: String = audit_logs::table
        .filter(audit_logs::tenant_id.eq(&app.tenant))
        .filter(audit_logs::action.eq("leave_request.approve"))
        .order(audit_logs::created_at.desc())
        .select(audit_logs::changes)
        .first::<Option<String>>(&mut conn)
        .unwrap()
        .unwrap();
    assert!(audited.contains("Intensive Care"), "the warning is on the audit entry: {audited}");
    drop(conn);
    drop_capabilities(&app);
    app.cleanup();
}

#[tokio::test]
async fn pending_leave_is_a_soft_preference_and_approved_leave_a_hard_absence() {
    let app = app!();
    {
        let mut conn = app.pool.get().unwrap();
        diesel::insert_into(workstations::table)
            .values((
                workstations::name.eq("Ward"),
                workstations::active_shift_ids.eq(vec![app.early]),
                workstations::tenant_id.eq(&app.tenant),
            ))
            .execute(&mut conn)
            .unwrap();
    }
    let id = id_of(&request(&app, &app.anna, 30, 31).await);
    let (from, to) = (text(day(28)), text(day(35)));

    let plan_input = |app: &TestApp| {
        let state = app.state.clone();
        let tenant = app.tenant.clone();
        let (from, to) = (from.clone(), to.clone());
        async move {
            let dto = OptimizerService::build_task_dto(&state, &tenant, None, Some(&from), Some(&to), None)
                .await
                .expect("task input");
            serde_json::to_value(dto).unwrap()
        }
    };
    let anna = |input: &Value, app: &TestApp| {
        input["employees"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == app.anna.id.to_string())
            .cloned()
            .expect("Anna in the input")
    };

    // Empty lists may be left out of the payload altogether.
    let dates = |employee: &Value, key: &str, field: Option<&str>| -> Vec<String> {
        employee[key]
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|item| field.map_or(item, |f| &item[f]).as_str().unwrap().to_string())
                    .collect()
            })
            .unwrap_or_default()
    };

    let before = anna(&plan_input(&app).await, &app);
    assert_eq!(dates(&before, "preferred_off", Some("date")), vec![text(day(30)), text(day(31))], "pending: would rather be off");
    assert!(dates(&before, "unavailability", None).is_empty(), "but not blocked");

    assert_eq!(app.post(&format!("/leave-requests/{id}/approve"), &app.planner(), Some(json!({})), None).await.0, 200);
    let after = anna(&plan_input(&app).await, &app);
    assert!(dates(&after, "preferred_off", Some("date")).is_empty(), "no longer a preference");
    assert_eq!(dates(&after, "unavailability", None), vec![text(day(30)), text(day(31))], "a hard absence now");

    let mut conn = app.pool.get().unwrap();
    let _ = diesel::delete(workstations::table.filter(workstations::tenant_id.eq(&app.tenant))).execute(&mut conn);
    drop(conn);
    app.cleanup();
}
