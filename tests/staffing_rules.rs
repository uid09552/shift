//! End-to-end tests for skill-mix and pairing rules (`/skill-mix-rules`,
//! `/pairing-rules`): who may keep them, what is refused, and that they reach the
//! solver's input (capabilities by name, like employees' skills).
//!
//! Needs PostgreSQL (`DATABASE_URL`, or the development default); without one
//! the tests print a notice and pass.

mod common;
mod roster_support;

use diesel::prelude::*;
use serde_json::{json, Value};
use uuid::Uuid;

use roster_support::{day, TestApp};
use shift::schema::{capabilities, workstations};
use shift::services::optimizer::OptimizerService;

macro_rules! app {
    () => {
        match TestApp::spawn("staffing-rules").await {
            Some(app) => app,
            None => return,
        }
    };
}

/// A capability and a ward that runs only the early shift.
fn setup(app: &TestApp) -> (Uuid, Uuid) {
    let mut conn = app.pool.get().unwrap();
    let senior: Uuid = diesel::insert_into(capabilities::table)
        .values((capabilities::name.eq("Senior nurse"), capabilities::tenant_id.eq(&app.tenant), capabilities::level.eq(3i16), capabilities::skill_group.eq("nursing")))
        .returning(capabilities::id)
        .get_result(&mut conn)
        .unwrap();
    let ward: Uuid = diesel::insert_into(workstations::table)
        .values((workstations::name.eq("ICU"), workstations::active_shift_ids.eq(vec![app.early]), workstations::tenant_id.eq(&app.tenant)))
        .returning(workstations::id)
        .get_result(&mut conn)
        .unwrap();
    (senior, ward)
}

fn cleanup(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    let _ = diesel::delete(workstations::table.filter(workstations::tenant_id.eq(&app.tenant))).execute(&mut conn);
    let _ = diesel::delete(capabilities::table.filter(capabilities::tenant_id.eq(&app.tenant))).execute(&mut conn);
    drop(conn);
    app.cleanup();
}

#[tokio::test]
async fn planners_keep_skill_mix_rules_and_viewers_see_none() {
    let app = app!();
    let (senior, ward) = setup(&app);
    let rule = json!({ "kind": "at_least", "count": 1, "capability_id": senior, "workstation_id": ward, "shift_id": app.early });

    assert_eq!(app.post("/skill-mix-rules", &app.viewer(&app.anna), Some(rule.clone()), None).await.0, 403);
    assert_eq!(app.get("/skill-mix-rules", &app.viewer(&app.anna)).await.0, 403);

    let (status, created) = app.post("/skill-mix-rules", &app.planner(), Some(rule), None).await;
    assert_eq!(status, 200, "{created}");
    assert_eq!((created["mode"].as_str(), created["count"].as_i64()), (Some("hard"), Some(1)), "hard unless said otherwise");
    assert!(created.get("tenant_id").is_none());

    let group = json!({ "kind": "at_least", "count": 2, "skill_group": "nursing", "min_level": 2, "mode": "soft" });
    assert_eq!(app.post("/skill-mix-rules", &app.planner(), Some(group), None).await.0, 200);

    let (_, list) = app.get("/skill-mix-rules", &app.planner()).await;
    assert_eq!(list.as_array().unwrap().len(), 2);

    let id = created["id"].as_str().unwrap();
    assert_eq!(app.delete(&format!("/skill-mix-rules/{id}"), &app.viewer(&app.anna), None).await.0, 403);
    assert_eq!(app.delete(&format!("/skill-mix-rules/{id}"), &app.planner(), None).await.0, 200);
    assert_eq!(app.delete(&format!("/skill-mix-rules/{id}"), &app.planner(), None).await.0, 404);
    cleanup(&app);
}

#[tokio::test]
async fn a_rule_that_cannot_mean_anything_is_refused() {
    let app = app!();
    let (senior, ward) = setup(&app);
    let refused = [
        json!({ "kind": "at_most", "count": 1, "skill_group": "nursing", "min_level": 1 }),   // at_most needs a capability
        json!({ "kind": "at_least", "count": 1 }),                                             // nobody to count
        json!({ "kind": "at_least", "count": 1, "capability_id": Uuid::new_v4() }),            // not ours
        json!({ "kind": "at_least", "count": 1, "capability_id": senior, "workstation_id": ward, "shift_id": app.late }), // ward does not run it
        json!({ "kind": "sometimes", "count": 1, "capability_id": senior }),
        json!({ "kind": "at_least", "count": 1, "capability_id": senior, "mode": "maybe" }),
        json!({ "kind": "at_least", "count": 500, "capability_id": senior }),
    ];
    for body in refused {
        let (status, answer) = app.post("/skill-mix-rules", &app.planner(), Some(body.clone()), None).await;
        assert_eq!(status, 400, "{body} → {answer}");
    }
    cleanup(&app);
}

#[tokio::test]
async fn pairing_rules_refuse_nonsense_and_contradictions() {
    let app = app!();
    let mentor = json!({ "kind": "mentor", "employee_id": app.anna.id, "partner_id": app.ben.id });
    let (status, created) = app.post("/pairing-rules", &app.planner(), Some(mentor.clone()), None).await;
    assert_eq!(status, 200, "{created}");
    assert_eq!(app.post("/pairing-rules", &app.planner(), Some(mentor), None).await.0, 409, "the same rule twice");
    // The other way round is a different mentor rule…
    let reverse = json!({ "kind": "mentor", "employee_id": app.ben.id, "partner_id": app.anna.id });
    assert_eq!(app.post("/pairing-rules", &app.planner(), Some(reverse), None).await.0, 200);
    // …but two who must work beside each other cannot also be kept apart.
    let apart = json!({ "kind": "apart", "employee_id": app.ben.id, "partner_id": app.anna.id });
    assert_eq!(app.post("/pairing-rules", &app.planner(), Some(apart), None).await.0, 409);

    let alone = json!({ "kind": "together", "employee_id": app.anna.id, "partner_id": app.anna.id });
    assert_eq!(app.post("/pairing-rules", &app.planner(), Some(alone), None).await.0, 400);
    let stranger = json!({ "kind": "together", "employee_id": app.anna.id, "partner_id": Uuid::new_v4() });
    assert_eq!(app.post("/pairing-rules", &app.planner(), Some(stranger), None).await.0, 400);

    assert_eq!(app.get("/pairing-rules", &app.viewer(&app.anna)).await.0, 403, "who works with whom is not for everyone");
    let (_, list) = app.get("/pairing-rules", &app.planner()).await;
    assert_eq!(list.as_array().unwrap().len(), 2);
    let id = created["id"].as_str().unwrap();
    assert_eq!(app.delete(&format!("/pairing-rules/{id}"), &app.planner(), None).await.0, 200);
    cleanup(&app);
}

#[tokio::test]
async fn the_rules_reach_the_solvers_input_with_capabilities_by_name() {
    let app = app!();
    let (senior, ward) = setup(&app);
    let rule = json!({ "kind": "at_least", "count": 1, "capability_id": senior, "workstation_id": ward, "mode": "soft" });
    assert_eq!(app.post("/skill-mix-rules", &app.planner(), Some(rule), None).await.0, 200);
    let pair = json!({ "kind": "apart", "employee_id": app.anna.id, "partner_id": app.ben.id });
    assert_eq!(app.post("/pairing-rules", &app.planner(), Some(pair), None).await.0, 200);

    let (from, to) = (day(1).to_string(), day(7).to_string());
    let input: Value = serde_json::to_value(
        OptimizerService::build_task_dto(&app.state, &app.tenant, None, Some(&from), Some(&to), None).await.expect("input"),
    )
    .unwrap();

    let mix = &input["skill_mix_rules"][0];
    assert_eq!(mix["capability"], "Senior nurse");
    assert_eq!(mix["workstation_id"], ward.to_string());
    assert_eq!(mix["mode"], "soft");
    assert!(mix.get("shift_id").is_none(), "any shift");
    let pair = &input["pairing_rules"][0];
    assert_eq!((pair["kind"].as_str(), pair["employee_id"].as_str()), (Some("apart"), Some(app.anna.id.to_string().as_str())));
    cleanup(&app);
}
