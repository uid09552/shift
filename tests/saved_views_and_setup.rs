//! End-to-end tests for saved views (`/saved-views`: per user, shared views,
//! default and last-used view) and the first-run setup checklist
//! (`/setup-status`, `/setup/sample-data`).
//!
//! Needs PostgreSQL (`DATABASE_URL`, or the development default); without one
//! the tests print a notice and pass.

mod common;
mod roster_support;

use diesel::prelude::*;
use serde_json::{json, Value};

use roster_support::TestApp;

macro_rules! app {
    ($label:expr) => {
        match TestApp::spawn($label).await {
            Some(app) => app,
            None => return,
        }
    };
}

fn cleanup(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    for table in [
        "saved_view_preferences",
        "saved_views",
        "planning_tasks",
        "employee_capabilities",
        "employee_available_shifts",
        "workstation_required_capabilities",
        "shift_weekday_times",
        "workstations",
        "capabilities",
    ] {
        let _ = diesel::sql_query(format!("DELETE FROM {table} WHERE tenant_id = $1"))
            .bind::<diesel::sql_types::Text, _>(&app.tenant)
            .execute(&mut conn);
    }
    drop(conn);
    app.cleanup();
}

async fn create(app: &TestApp, token: &str, body: Value) -> (u16, Value) {
    app.post("/saved-views", token, Some(body), None).await
}

fn names(list: &Value) -> Vec<String> {
    list["views"].as_array().unwrap().iter().map(|v| v["name"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn views_are_the_callers_own_unless_shared() {
    let app = app!("views");
    let anna = app.viewer(&app.anna);
    let ben = app.viewer(&app.ben);

    let filters = json!({"view": "month", "workstations": ["w1"], "capabilities": []});
    let (status, mine) = create(&app, &anna, json!({"page": "schedule", "name": " Night team ", "filters": filters})).await;
    assert_eq!(status, 200, "{mine}");
    assert_eq!(mine["name"], "Night team", "names are trimmed");
    assert_eq!(mine["filters"], filters);
    assert_eq!(mine["mine"], true);
    assert_eq!(mine["shared"], false);

    let (_, list) = app.get("/saved-views?page=schedule", &anna).await;
    assert_eq!(names(&list), ["Night team"]);
    let (_, list) = app.get("/saved-views?page=schedule", &ben).await;
    assert!(names(&list).is_empty(), "someone else's private view is not listed: {list}");

    // A second one of the same name (any case) is refused; another user may use it.
    let (status, _) = create(&app, &anna, json!({"page": "schedule", "name": "NIGHT TEAM"})).await;
    assert_eq!(status, 409);
    let (status, _) = create(&app, &ben, json!({"page": "schedule", "name": "Night team"})).await;
    assert_eq!(status, 200);

    // Not someone else's to change or delete.
    let id = mine["id"].as_str().unwrap();
    let (status, _) = app.put(&format!("/saved-views/{id}"), &ben, json!({"name": "Mine now"}), None).await;
    assert_eq!(status, 404);
    let (status, _) = app.delete(&format!("/saved-views/{id}"), &ben, None).await;
    assert_eq!(status, 404);

    // Bad input.
    for body in [
        json!({"page": "schedule", "name": "  "}),
        json!({"page": "nowhere", "name": "x"}),
        json!({"page": "schedule", "name": "x", "filters": [1]}),
    ] {
        let (status, answer) = create(&app, &anna, body.clone()).await;
        assert_eq!(status, 400, "{body} → {answer}");
    }

    // Renaming and new filters.
    let (status, renamed) = app
        .put(&format!("/saved-views/{id}"), &anna, json!({"name": "Nights", "filters": {"view": "week"}}), None)
        .await;
    assert_eq!(status, 200, "{renamed}");
    assert_eq!((renamed["name"].as_str(), renamed["filters"]["view"].as_str()), (Some("Nights"), Some("week")));

    let (status, _) = app.delete(&format!("/saved-views/{id}"), &anna, None).await;
    assert_eq!(status, 200);
    let (_, list) = app.get("/saved-views?page=schedule", &anna).await;
    assert!(names(&list).is_empty());
    cleanup(&app);
}

#[tokio::test]
async fn planners_share_views_and_only_owner_or_admin_change_them() {
    let app = app!("views-shared");
    let anna = app.viewer(&app.anna);

    let (status, _) = create(&app, &anna, json!({"page": "schedule", "name": "For all", "shared": true})).await;
    assert_eq!(status, 403, "a viewer cannot share");

    let (status, shared) = create(&app, &app.planner(), json!({"page": "schedule", "name": "ICU week", "shared": true})).await;
    assert_eq!(status, 200, "{shared}");
    let id = shared["id"].as_str().unwrap().to_string();

    let (_, list) = app.get("/saved-views?page=schedule", &anna).await;
    assert_eq!(names(&list), ["ICU week"]);
    assert_eq!(list["views"][0]["mine"], false);
    assert_eq!(list["views"][0]["owner_name"], "planner@test.invalid");

    let (status, _) = app.put(&format!("/saved-views/{id}"), &anna, json!({"name": "Hijack"}), None).await;
    assert_eq!(status, 403, "visible, but not the viewer's to change");
    let (status, _) = app.put(&format!("/saved-views/{id}"), &app.admin(), json!({"name": "ICU (all)"}), None).await;
    assert_eq!(status, 200, "an admin tidies up shared views");

    // A viewer may make someone's shared view their default; unsharing takes it away again.
    let (status, pref) = app
        .put("/saved-views/preferences", &anna, json!({"page": "schedule", "default_view_id": id, "last_view_id": id}), None)
        .await;
    assert_eq!(status, 200, "{pref}");
    let (_, list) = app.get("/saved-views?page=schedule", &anna).await;
    assert_eq!((list["default_view_id"].as_str(), list["last_view_id"].as_str()), (Some(id.as_str()), Some(id.as_str())));

    let (status, _) = app.put(&format!("/saved-views/{id}"), &app.planner(), json!({"shared": false}), None).await;
    assert_eq!(status, 200);
    let (_, list) = app.get("/saved-views?page=schedule", &anna).await;
    assert!(names(&list).is_empty());
    assert_eq!(list["default_view_id"], Value::Null, "a view no longer shared is nobody else's default");
    cleanup(&app);
}

#[tokio::test]
async fn the_default_and_last_used_view_are_remembered_per_user() {
    let app = app!("views-pref");
    let anna = app.viewer(&app.anna);
    let ben = app.viewer(&app.ben);
    let (_, a) = create(&app, &anna, json!({"page": "schedule", "name": "A"})).await;
    let (_, b) = create(&app, &anna, json!({"page": "schedule", "name": "B"})).await;
    let (_, bens) = create(&app, &ben, json!({"page": "schedule", "name": "Ben's"})).await;

    let (_, list) = app.get("/saved-views?page=schedule", &anna).await;
    assert_eq!((list["default_view_id"].clone(), list["last_view_id"].clone()), (Value::Null, Value::Null));

    let (status, _) = app
        .put("/saved-views/preferences", &anna, json!({"page": "schedule", "default_view_id": a["id"], "last_view_id": b["id"]}), None)
        .await;
    assert_eq!(status, 200);
    let (_, list) = app.get("/saved-views?page=schedule", &anna).await;
    assert_eq!((list["default_view_id"].clone(), list["last_view_id"].clone()), (a["id"].clone(), b["id"].clone()));
    let (_, list) = app.get("/saved-views?page=schedule", &ben).await;
    assert_eq!(list["default_view_id"], Value::Null, "per user");

    // Someone else's private view cannot be a default.
    let (status, _) = app
        .put("/saved-views/preferences", &anna, json!({"page": "schedule", "default_view_id": bens["id"], "last_view_id": null}), None)
        .await;
    assert_eq!(status, 404);

    // Deleting the default clears it.
    app.delete(&format!("/saved-views/{}", a["id"].as_str().unwrap()), &anna, None).await;
    let (_, list) = app.get("/saved-views?page=schedule", &anna).await;
    assert_eq!(list["default_view_id"], Value::Null);
    assert_eq!(list["last_view_id"], b["id"]);
    cleanup(&app);
}

fn step<'a>(status: &'a Value, id: &str) -> &'a Value {
    status["steps"].as_array().unwrap().iter().find(|s| s["id"] == id).unwrap()
}

#[tokio::test]
async fn the_setup_checklist_follows_the_tenants_data_and_sample_data_fills_an_empty_one() {
    let app = app!("setup");
    let (status, before) = app.get("/setup-status", &app.admin()).await;
    assert_eq!(status, 200, "{before}");
    assert_eq!(step(&before, "employees")["done"], true, "the test tenant has Anna and Ben");
    assert_eq!(step(&before, "shifts")["done"], false, "shifts without times are never planned");
    assert_eq!(step(&before, "first_plan")["done"], false);
    assert_eq!(before["complete"], false);
    assert_eq!(before["sample_data_available"], false);

    let (status, _) = app.post("/setup/sample-data", &app.admin(), None, None).await;
    assert_eq!(status, 409, "never next to real data");

    // Empty the tenant: now sample data may go in, but only for an admin.
    {
        let mut conn = app.pool.get().unwrap();
        diesel::delete(shift::schema::employees::table.filter(shift::schema::employees::tenant_id.eq(&app.tenant)))
            .execute(&mut conn)
            .unwrap();
        diesel::delete(shift::schema::shifts::table.filter(shift::schema::shifts::tenant_id.eq(&app.tenant)))
            .execute(&mut conn)
            .unwrap();
    }
    let (_, empty) = app.get("/setup-status", &app.planner()).await;
    assert_eq!(empty["sample_data_available"], true);
    let (status, _) = app.post("/setup/sample-data", &app.planner(), None, None).await;
    assert_eq!(status, 403);

    let (status, after) = app.post("/setup/sample-data", &app.admin(), None, None).await;
    assert_eq!(status, 200, "{after}");
    for id in ["shifts", "capabilities", "workstations", "employees"] {
        assert_eq!(step(&after, id)["done"], true, "{id}: {after}");
    }
    assert_eq!(step(&after, "shifts")["count"], 3);
    assert_eq!(step(&after, "employees")["count"], 8);
    assert_eq!(after["sample_data_available"], false);

    // What went in is a plannable tenant: everyone can work every shift, wards need their skill.
    let (_, employees) = app.get("/employees", &app.admin()).await;
    let employees = employees["data"].as_array().cloned().unwrap_or_default();
    assert_eq!(employees.len(), 8, "{employees:?}");
    let (_, workstations) = app.get("/workstations", &app.admin()).await;
    let icu = workstations.as_array().unwrap().iter().find(|w| w["name"] == "ICU").unwrap();
    assert_eq!(icu["priority"], "high");
    assert_eq!(icu["active_shift_ids"].as_array().unwrap().len(), 3);

    let (status, _) = app.post("/setup/sample-data", &app.admin(), None, None).await;
    assert_eq!(status, 409, "only once");
    cleanup(&app);
}
