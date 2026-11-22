//! End-to-end tests for capabilities that lapse (#179) and recurring
//! availability (#180): the endpoints, what the solver's input gets from them,
//! and that an open shift respects both.
//!
//! Needs PostgreSQL (`DATABASE_URL`, or the development default); without one
//! the tests print a notice and pass.

mod common;
mod roster_support;

use diesel::prelude::*;
use serde_json::{json, Value};
use uuid::Uuid;

use roster_support::{day, TestApp};
use shift::schema::{capabilities, employee_available_shifts, employee_capabilities, workstation_required_capabilities, workstations};
use shift::services::optimizer::OptimizerService;

macro_rules! app {
    () => {
        match TestApp::spawn("expiry-availability").await {
            Some(app) => app,
            None => return,
        }
    };
}

/// A "Resuscitation" capability Anna holds, and a ward that requires it.
fn setup(app: &TestApp) -> (Uuid, Uuid) {
    let mut conn = app.pool.get().unwrap();
    let resus: Uuid = diesel::insert_into(capabilities::table)
        .values((capabilities::name.eq("Resuscitation"), capabilities::tenant_id.eq(&app.tenant)))
        .returning(capabilities::id)
        .get_result(&mut conn)
        .unwrap();
    diesel::insert_into(employee_capabilities::table)
        .values((
            employee_capabilities::employee_id.eq(app.anna.id),
            employee_capabilities::capability_id.eq(resus),
            employee_capabilities::tenant_id.eq(&app.tenant),
        ))
        .execute(&mut conn)
        .unwrap();
    let ward: Uuid = diesel::insert_into(workstations::table)
        .values((workstations::name.eq("ICU"), workstations::active_shift_ids.eq(vec![app.early, app.late]), workstations::tenant_id.eq(&app.tenant)))
        .returning(workstations::id)
        .get_result(&mut conn)
        .unwrap();
    diesel::insert_into(workstation_required_capabilities::table)
        .values((
            workstation_required_capabilities::workstation_id.eq(ward),
            workstation_required_capabilities::capability_id.eq(resus),
            workstation_required_capabilities::tenant_id.eq(&app.tenant),
        ))
        .execute(&mut conn)
        .unwrap();
    for shift in [app.early, app.late] {
        diesel::insert_into(employee_available_shifts::table)
            .values((
                employee_available_shifts::employee_id.eq(app.anna.id),
                employee_available_shifts::shift_id.eq(shift),
                employee_available_shifts::tenant_id.eq(&app.tenant),
            ))
            .execute(&mut conn)
            .unwrap();
    }
    (resus, ward)
}

fn cleanup(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    let t = &app.tenant;
    let _ = diesel::delete(workstation_required_capabilities::table.filter(workstation_required_capabilities::tenant_id.eq(t))).execute(&mut conn);
    let _ = diesel::delete(workstations::table.filter(workstations::tenant_id.eq(t))).execute(&mut conn);
    let _ = diesel::delete(employee_available_shifts::table.filter(employee_available_shifts::tenant_id.eq(t))).execute(&mut conn);
    let _ = diesel::delete(employee_capabilities::table.filter(employee_capabilities::tenant_id.eq(t))).execute(&mut conn);
    let _ = diesel::delete(capabilities::table.filter(capabilities::tenant_id.eq(t))).execute(&mut conn);
    drop(conn);
    app.cleanup();
}

/// Anna in the solver's input for `day(from)` … `day(to)`.
async fn anna_in_input(app: &TestApp, from: i64, to: i64) -> Value {
    let (from, to) = (day(from).to_string(), day(to).to_string());
    let input = serde_json::to_value(
        OptimizerService::build_task_dto(&app.state, &app.tenant, None, Some(&from), Some(&to), None).await.expect("input"),
    )
    .unwrap();
    input["employees"].as_array().unwrap().iter().find(|e| e["id"] == app.anna.id.to_string()).cloned().expect("Anna")
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().map(|a| a.iter().map(|v| v.as_str().unwrap_or_default().to_string()).collect()).unwrap_or_default()
}

// ── #179: capabilities that lapse ───────────────────────────────────────────

#[tokio::test]
async fn a_planner_sets_when_a_capability_lapses_and_sees_it_coming() {
    let app = app!();
    let (resus, _) = setup(&app);
    let path = format!("/employees/{}/capabilities/{resus}", app.anna.id);

    assert_eq!(app.put(&path, &app.viewer(&app.anna), json!({ "valid_until": day(10) }), None).await.0, 403);
    let (status, body) = app.put(&path, &app.planner(), json!({ "valid_until": day(10) }), None).await;
    assert_eq!(status, 200, "{body}");
    let not_held = format!("/employees/{}/capabilities/{resus}", app.ben.id);
    assert_eq!(app.put(&not_held, &app.planner(), json!({ "valid_until": day(10) }), None).await.0, 404);

    let (status, list) = app.get("/capability-expiries?within_days=30", &app.planner()).await;
    assert_eq!(status, 200, "{list}");
    let row = &list[0];
    assert_eq!((row["employee_name"].as_str(), row["capability_name"].as_str()), (Some("Anna"), Some("Resuscitation")));
    assert_eq!((row["days_left"].as_i64(), row["expired"].as_bool()), (Some(10), Some(false)));
    let (_, soon) = app.get("/capability-expiries?within_days=5", &app.planner()).await;
    assert_eq!(soon, json!([]), "not within five days");
    assert_eq!(app.get("/capability-expiries", &app.viewer(&app.anna)).await.0, 403);

    // Lapsed already: always listed, and marked.
    app.put(&path, &app.planner(), json!({ "valid_until": day(-1) }), None).await;
    let (_, list) = app.get("/capability-expiries?within_days=0", &app.planner()).await;
    assert_eq!(list[0]["expired"], true);

    // The employee's own record says so too.
    let (_, held) = app.get(&format!("/employees/{}/capabilities", app.anna.id), &app.planner()).await;
    assert_eq!(held[0]["valid_until"], day(-1).to_string());

    // Cleared: no longer listed.
    app.put(&path, &app.planner(), json!({ "valid_until": null }), None).await;
    let (_, list) = app.get("/capability-expiries?within_days=366", &app.planner()).await;
    assert_eq!(list, json!([]));
    cleanup(&app);
}

#[tokio::test]
async fn the_solver_sees_a_capability_only_while_it_is_valid() {
    let app = app!();
    let (resus, _) = setup(&app);
    let path = format!("/employees/{}/capabilities/{resus}", app.anna.id);

    // Lapses inside the period: held, with its last day.
    app.put(&path, &app.planner(), json!({ "valid_until": day(10) }), None).await;
    let anna = anna_in_input(&app, 5, 20).await;
    assert_eq!(strings(&anna["skills"]), vec!["Resuscitation"]);
    assert_eq!(anna["skill_expiry"]["Resuscitation"], day(10).to_string());

    // Lapsed before the period: not held at all.
    app.put(&path, &app.planner(), json!({ "valid_until": day(2) }), None).await;
    let anna = anna_in_input(&app, 5, 20).await;
    assert!(strings(&anna["skills"]).is_empty());

    // Lapses after it: plainly held.
    app.put(&path, &app.planner(), json!({ "valid_until": day(90) }), None).await;
    let anna = anna_in_input(&app, 5, 20).await;
    assert_eq!(strings(&anna["skills"]), vec!["Resuscitation"]);
    assert!(anna.get("skill_expiry").is_none());
    cleanup(&app);
}

#[tokio::test]
async fn an_open_shift_needs_a_capability_that_is_still_valid() {
    let app = app!();
    let (resus, ward) = setup(&app);
    app.put(&format!("/employees/{}/capabilities/{resus}", app.anna.id), &app.planner(), json!({ "valid_until": day(5) }), None).await;
    let (_, offer) = app
        .post("/open-shifts", &app.planner(), Some(json!({ "date": day(10).to_string(), "shift_id": app.early, "workstation_id": ward })), None)
        .await;
    let (status, body) = app.post(&format!("/open-shifts/{}/volunteer", offer["id"].as_str().unwrap()), &app.viewer(&app.anna), None, None).await;
    assert_eq!(status, 400, "{body}");
    assert!(body["error"].as_str().unwrap().contains("Lacks Resuscitation"), "{body}");
    cleanup(&app);
}

// ── #180: recurring availability ────────────────────────────────────────────

#[tokio::test]
async fn planners_keep_availability_rules_and_an_employee_reads_their_own() {
    let app = app!();
    let path = format!("/employees/{}/availability-rules", app.anna.id);
    let rule = json!({ "kind": "not_weekdays", "weekdays": [2], "mode": "hard", "note": "Childcare" });

    assert_eq!(app.post(&path, &app.viewer(&app.anna), Some(rule.clone()), None).await.0, 403, "planners keep them");
    let (status, created) = app.post(&path, &app.planner(), Some(rule), None).await;
    assert_eq!(status, 200, "{created}");
    assert_eq!(created["weekdays"], json!([2]));

    let (status, own) = app.get(&path, &app.viewer(&app.anna)).await;
    assert_eq!((status, own.as_array().map(Vec::len)), (200, Some(1)));
    assert_eq!(app.get(&path, &app.viewer(&app.ben)).await.0, 403, "not Ben's to read");
    assert_eq!(app.get("/availability-rules", &app.viewer(&app.anna)).await.0, 403);

    for bad in [
        json!({ "kind": "sometimes", "weekdays": [1] }),
        json!({ "kind": "not_weekdays", "weekdays": [] }),
        json!({ "kind": "not_weekdays", "weekdays": [7] }),
        json!({ "kind": "not_weekdays", "weekdays": [0, 1, 2, 3, 4, 5, 6] }),
        json!({ "kind": "only_shifts", "shift_ids": [] }),
        json!({ "kind": "only_shifts", "shift_ids": [Uuid::new_v4()] }),
        json!({ "kind": "not_shifts", "shift_ids": [app.late], "mode": "maybe" }),
        json!({ "kind": "not_shifts", "shift_ids": [app.late], "valid_from": day(10), "valid_until": day(5) }),
    ] {
        assert_eq!(app.post(&path, &app.planner(), Some(bad.clone()), None).await.0, 400, "{bad}");
    }

    let id = created["id"].as_str().unwrap();
    assert_eq!(app.delete(&format!("{path}/{id}"), &app.planner(), None).await.0, 200);
    assert_eq!(app.delete(&format!("{path}/{id}"), &app.planner(), None).await.0, 404);
    app.cleanup();
}

#[tokio::test]
async fn rules_reach_the_solver_as_absences_blocked_shifts_and_preferences() {
    let app = app!();
    setup(&app);
    let path = format!("/employees/{}/availability-rules", app.anna.id);
    // Never late (hard), would rather not work on day(7)'s weekday (soft).
    app.post(&path, &app.planner(), Some(json!({ "kind": "not_shifts", "shift_ids": [app.late], "mode": "hard" })), None).await;
    let weekday = chrono::Datelike::weekday(&day(7)).num_days_from_monday();
    app.post(&path, &app.planner(), Some(json!({ "kind": "not_weekdays", "weekdays": [weekday], "mode": "soft" })), None).await;
    // And day(9)'s weekday is hard off.
    let hard_day = chrono::Datelike::weekday(&day(9)).num_days_from_monday();
    app.post(&path, &app.planner(), Some(json!({ "kind": "not_weekdays", "weekdays": [hard_day], "mode": "hard" })), None).await;

    let anna = anna_in_input(&app, 7, 9).await;
    assert_eq!(strings(&anna["unavailability"]), vec![day(9).to_string()], "the hard weekday is a day off");
    let blocked: Vec<(String, String)> = anna["blocked_shifts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| (b["date"].as_str().unwrap().to_string(), b["shift_id"].as_str().unwrap().to_string()))
        .collect();
    assert_eq!(
        blocked,
        vec![(day(7).to_string(), app.late.to_string()), (day(8).to_string(), app.late.to_string())],
        "never late — except on the day already off"
    );
    let preferred: Vec<&str> = anna["preferred_off"].as_array().unwrap().iter().filter(|p| p.get("shift_id").is_none()).map(|p| p["date"].as_str().unwrap()).collect();
    assert_eq!(preferred, vec![day(7).to_string()], "the soft weekday is a preference");
    cleanup(&app);
}

#[tokio::test]
async fn an_open_shift_respects_a_hard_availability_rule() {
    let app = app!();
    let (_, ward) = setup(&app);
    let path = format!("/employees/{}/availability-rules", app.anna.id);
    app.post(&path, &app.planner(), Some(json!({ "kind": "only_shifts", "shift_ids": [app.early], "mode": "hard" })), None).await;

    let (_, late) = app
        .post("/open-shifts", &app.planner(), Some(json!({ "date": day(10).to_string(), "shift_id": app.late, "workstation_id": ward })), None)
        .await;
    let (status, body) = app.post(&format!("/open-shifts/{}/volunteer", late["id"].as_str().unwrap()), &app.viewer(&app.anna), None, None).await;
    assert_eq!(status, 400, "{body}");
    assert!(body["error"].as_str().unwrap().contains("standing availability"), "{body}");

    let (_, early) = app
        .post("/open-shifts", &app.planner(), Some(json!({ "date": day(10).to_string(), "shift_id": app.early, "workstation_id": ward })), None)
        .await;
    assert_eq!(app.post(&format!("/open-shifts/{}/volunteer", early["id"].as_str().unwrap()), &app.viewer(&app.anna), None, None).await.0, 200);
    cleanup(&app);
}
