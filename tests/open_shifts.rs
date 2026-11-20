//! End-to-end tests for open shifts (`/open-shifts`): who may post, volunteer
//! and assign, why someone may not take a slot, what assigning does to the
//! confirmed roster (under the roster guard), closing, the gaps listing, and the
//! mail an offer sends.
//!
//! Like the other suites these drive the real router over HTTP against a real
//! database, with signed tokens. Needs PostgreSQL (`DATABASE_URL`, or the
//! development default); without one the tests print a notice and pass.

mod common;
mod roster_support;

use std::sync::Arc;

use chrono::NaiveTime;
use diesel::prelude::*;
use serde_json::{json, Value};
use uuid::Uuid;

use roster_support::{day, TestApp};
use shift::schema::{
    audit_logs, employee_available_shifts, notification_outbox, roster_change_notices, shift_weekday_times, workstations,
};
use shift::services::notifier::RecordingMailer;

macro_rules! app {
    () => {
        match TestApp::spawn("open-shifts").await {
            Some(app) => app,
            None => return,
        }
    };
}

fn at(hour: u32) -> NaiveTime {
    NaiveTime::from_hms_opt(hour, 0, 0).unwrap()
}

/// Every weekday of `shift` runs from `start` to `end`.
fn give_times(app: &TestApp, shift: Uuid, start: u32, end: u32) {
    let mut conn = app.pool.get().unwrap();
    for weekday in 0..7i16 {
        diesel::insert_into(shift_weekday_times::table)
            .values((
                shift_weekday_times::shift_id.eq(shift),
                shift_weekday_times::weekday.eq(weekday),
                shift_weekday_times::start_time.eq(at(start)),
                shift_weekday_times::end_time.eq(at(end)),
                shift_weekday_times::min_employees.eq(1i16),
                shift_weekday_times::free_days_after_shift.eq(0i16),
                shift_weekday_times::tenant_id.eq(&app.tenant),
            ))
            .execute(&mut conn)
            .unwrap();
    }
}

fn may_work(app: &TestApp, who: Uuid, shift: Uuid) {
    let mut conn = app.pool.get().unwrap();
    diesel::insert_into(employee_available_shifts::table)
        .values((
            employee_available_shifts::employee_id.eq(who),
            employee_available_shifts::shift_id.eq(shift),
            employee_available_shifts::tenant_id.eq(&app.tenant),
        ))
        .execute(&mut conn)
        .unwrap();
}

/// A ward that runs the early and late shifts and needs `minimum` people on each.
fn ward(app: &TestApp, minimum: i16) -> Uuid {
    let mut conn = app.pool.get().unwrap();
    diesel::insert_into(workstations::table)
        .values((
            workstations::name.eq("Ward"),
            workstations::active_shift_ids.eq(vec![app.early, app.late]),
            workstations::min_employees.eq(minimum),
            workstations::tenant_id.eq(&app.tenant),
        ))
        .returning(workstations::id)
        .get_result(&mut conn)
        .unwrap()
}

fn drop_wards(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    let _ = diesel::delete(workstations::table.filter(workstations::tenant_id.eq(&app.tenant))).execute(&mut conn);
    let _ = diesel::delete(shift_weekday_times::table.filter(shift_weekday_times::tenant_id.eq(&app.tenant))).execute(&mut conn);
    let _ = diesel::delete(employee_available_shifts::table.filter(employee_available_shifts::tenant_id.eq(&app.tenant)))
        .execute(&mut conn);
}

async fn post(app: &TestApp, offset: i64, shift: Uuid) -> Value {
    let body = json!({ "date": day(offset).to_string(), "shift_id": shift, "note": "Short staffed" });
    let (status, offer) = app.post("/open-shifts", &app.planner(), Some(body), None).await;
    assert_eq!(status, 200, "{offer}");
    offer
}

fn id_of(offer: &Value) -> String {
    offer["id"].as_str().expect("id").to_string()
}

#[tokio::test]
async fn only_a_planner_posts_a_slot_and_only_once() {
    let app = app!();
    let ward = ward(&app, 1);
    let body = json!({ "date": day(10).to_string(), "shift_id": app.early, "workstation_id": ward });

    assert_eq!(app.post("/open-shifts", &app.viewer(&app.anna), Some(body.clone()), None).await.0, 403);
    let (status, offer) = app.post("/open-shifts", &app.planner(), Some(body.clone()), None).await;
    assert_eq!(status, 200, "{offer}");
    assert_eq!(offer["status"], "open");
    assert!(offer.get("tenant_id").is_none());
    let (status, again) = app.post("/open-shifts", &app.planner(), Some(body), None).await;
    assert_eq!(status, 409, "one offer per slot: {again}");

    let past = json!({ "date": day(-1).to_string(), "shift_id": app.early });
    assert_eq!(app.post("/open-shifts", &app.planner(), Some(past), None).await.0, 400);
    let nobody = json!({ "date": day(10).to_string(), "shift_id": Uuid::new_v4() });
    assert_eq!(app.post("/open-shifts", &app.planner(), Some(nobody), None).await.0, 400);

    // A ward that does not run the shift cannot be offered it.
    let other = {
        let mut conn = app.pool.get().unwrap();
        diesel::insert_into(workstations::table)
            .values((workstations::name.eq("Day ward"), workstations::active_shift_ids.eq(vec![app.late]), workstations::tenant_id.eq(&app.tenant)))
            .returning(workstations::id)
            .get_result::<Uuid>(&mut conn)
            .unwrap()
    };
    let wrong = json!({ "date": day(11).to_string(), "shift_id": app.early, "workstation_id": other });
    assert_eq!(app.post("/open-shifts", &app.planner(), Some(wrong), None).await.0, 400);
    drop_wards(&app);
    app.cleanup();
}

#[tokio::test]
async fn only_someone_who_may_take_it_can_volunteer_and_is_told_why_not() {
    let app = app!();
    let offer = post(&app, 10, app.early).await;
    let id = id_of(&offer);

    // Neither has the shift in their availability yet.
    let (status, body) = app.post(&format!("/open-shifts/{id}/volunteer"), &app.viewer(&app.anna), None, None).await;
    assert_eq!(status, 400, "{body}");
    assert!(body["error"].as_str().unwrap().contains("Not available for the Early shift"), "{body}");

    may_work(&app, app.anna.id, app.early);
    may_work(&app, app.ben.id, app.early);
    app.roster(app.ben.id, day(10), Some(app.late));

    let (status, body) = app.post(&format!("/open-shifts/{id}/volunteer"), &app.viewer(&app.ben), None, None).await;
    assert_eq!(status, 400, "Ben already works that day: {body}");
    assert!(body["error"].as_str().unwrap().contains("Already working that day"), "{body}");
    assert_eq!(app.post(&format!("/open-shifts/{id}/volunteer"), &app.planner(), None, None).await.0, 403, "planners assign");

    assert_eq!(app.post(&format!("/open-shifts/{id}/volunteer"), &app.viewer(&app.anna), None, None).await.0, 200);
    assert_eq!(app.post(&format!("/open-shifts/{id}/volunteer"), &app.viewer(&app.anna), None, None).await.0, 200, "twice is once");

    // Each viewer sees the slot and what it means for them — not who else volunteered.
    let (_, anna) = app.get("/open-shifts", &app.viewer(&app.anna)).await;
    assert_eq!((anna[0]["eligible"].clone(), anna[0]["volunteered"].clone(), anna[0]["volunteer_count"].clone()), (json!(true), json!(true), json!(1)));
    assert!(anna[0].get("volunteers").is_none());
    let (_, ben) = app.get("/open-shifts", &app.viewer(&app.ben)).await;
    assert_eq!((ben[0]["eligible"].clone(), ben[0]["volunteered"].clone()), (json!(false), json!(false)));
    assert_eq!(ben[0]["reasons"], json!(["Already working that day"]));

    // The planner sees the volunteers.
    let (_, planner) = app.get("/open-shifts", &app.planner()).await;
    let volunteers = planner[0]["volunteers"].as_array().unwrap();
    assert_eq!(volunteers.len(), 1);
    assert_eq!((volunteers[0]["employee_id"].as_str(), volunteers[0]["eligible"].as_bool()), (Some(app.anna.id.to_string().as_str()), Some(true)));

    let (status, _) = app.post(&format!("/open-shifts/{id}/withdraw"), &app.viewer(&app.anna), None, None).await;
    assert_eq!(status, 200);
    assert_eq!(app.post(&format!("/open-shifts/{id}/withdraw"), &app.viewer(&app.anna), None, None).await.0, 404, "nothing left to withdraw");
    let (_, planner) = app.get("/open-shifts", &app.planner()).await;
    assert_eq!(planner[0]["volunteers"], json!([]));
    drop_wards(&app);
    app.cleanup();
}

#[tokio::test]
async fn too_little_rest_keeps_someone_from_taking_a_slot() {
    let app = app!();
    give_times(&app, app.early, 6, 14);
    give_times(&app, app.late, 14, 22);
    may_work(&app, app.anna.id, app.early);
    // A late shift the day before ends at 22:00; the early one starts at 06:00 — 8 h.
    app.roster(app.anna.id, day(9), Some(app.late));
    let id = id_of(&post(&app, 10, app.early).await);

    let (status, body) = app.post(&format!("/open-shifts/{id}/volunteer"), &app.viewer(&app.anna), None, None).await;
    assert_eq!(status, 400, "{body}");
    assert!(body["error"].as_str().unwrap().contains("8.0 h rest"), "{body}");
    drop_wards(&app);
    app.cleanup();
}

#[tokio::test]
async fn assigning_writes_the_roster_and_fills_the_slot_once() {
    let app = app!();
    may_work(&app, app.anna.id, app.early);
    app.roster(app.anna.id, day(10), None); // a planned day off makes way
    let ward = ward(&app, 1);
    let offer = {
        let body = json!({ "date": day(10).to_string(), "shift_id": app.early, "workstation_id": ward });
        let (status, offer) = app.post("/open-shifts", &app.planner(), Some(body), None).await;
        assert_eq!(status, 200, "{offer}");
        offer
    };
    let id = id_of(&offer);
    let assign = json!({ "employee_id": app.anna.id });

    assert_eq!(app.post(&format!("/open-shifts/{id}/assign"), &app.viewer(&app.anna), Some(assign.clone()), None).await.0, 403);
    let (status, body) = app.post(&format!("/open-shifts/{id}/assign"), &app.planner(), Some(json!({ "employee_id": app.ben.id })), None).await;
    assert_eq!(status, 400, "Ben may not work the early shift: {body}");
    assert!(body["error"].as_str().unwrap().contains("Ben cannot take this shift"), "{body}");
    assert_eq!(app.post(&format!("/open-shifts/{id}/assign"), &app.planner(), Some(json!({ "employee_id": Uuid::new_v4() })), None).await.0, 400);

    let (status, filled) = app.post(&format!("/open-shifts/{id}/assign"), &app.planner(), Some(assign.clone()), None).await;
    assert_eq!(status, 200, "{filled}");
    assert_eq!(filled["status"], "filled");
    assert_eq!(filled["assigned_employee_id"], app.anna.id.to_string());
    assert_eq!(app.roster_cell(app.anna.id, day(10)), Some(Some(app.early)), "the day off became the shift");

    let (status, _) = app.post(&format!("/open-shifts/{id}/assign"), &app.planner(), Some(assign), None).await;
    assert_eq!(status, 409, "filled once");
    assert_eq!(app.post(&format!("/open-shifts/{id}/volunteer"), &app.viewer(&app.anna), None, None).await.0, 409);
    assert_eq!(app.post(&format!("/open-shifts/{id}/close"), &app.planner(), None, None).await.0, 409);

    let (_, open) = app.get("/open-shifts", &app.planner()).await;
    assert_eq!(open, json!([]), "no longer open");
    let (_, all) = app.get("/open-shifts?status=filled", &app.planner()).await;
    assert_eq!(all.as_array().unwrap().len(), 1);

    let mut conn = app.pool.get().unwrap();
    let actions: Vec<String> = audit_logs::table
        .filter(audit_logs::tenant_id.eq(&app.tenant))
        .filter(audit_logs::entity_type.eq("open_shift"))
        .order(audit_logs::created_at.asc())
        .select(audit_logs::action)
        .load(&mut conn)
        .unwrap();
    assert_eq!(actions, vec!["open_shift.create", "open_shift.assign"]);
    drop(conn);
    drop_wards(&app);
    app.cleanup();
}

#[tokio::test]
async fn assigning_in_a_published_month_follows_the_roster_guard() {
    let app = app!();
    may_work(&app, app.anna.id, app.early);
    app.set_month(day(1), "published");
    let id = id_of(&post(&app, 1, app.early).await);
    let assign = json!({ "employee_id": app.anna.id });

    let (status, body) = app.post(&format!("/open-shifts/{id}/assign"), &app.planner(), Some(assign.clone()), None).await;
    assert_eq!(status, 428, "inside the freeze window a reason is needed: {body}");
    assert_eq!(app.roster_cell(app.anna.id, day(1)), None, "nothing was written");
    let (_, still) = app.get("/open-shifts", &app.planner()).await;
    assert_eq!(still[0]["status"], "open", "and the slot is still open");

    let (status, body) = app.post(&format!("/open-shifts/{id}/assign"), &app.planner(), Some(assign), Some("Called in")).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(app.roster_cell(app.anna.id, day(1)), Some(Some(app.early)));

    let mut conn = app.pool.get().unwrap();
    let notices: Vec<(Uuid, Option<String>)> = roster_change_notices::table
        .filter(roster_change_notices::tenant_id.eq(&app.tenant))
        .select((roster_change_notices::employee_id, roster_change_notices::reason))
        .load(&mut conn)
        .unwrap();
    assert_eq!(notices, vec![(app.anna.id, Some("Called in".to_string()))], "Anna is told, with the reason");
    drop(conn);
    app.cleanup();
}

#[tokio::test]
async fn closing_withdraws_the_offer() {
    let app = app!();
    may_work(&app, app.anna.id, app.early);
    let id = id_of(&post(&app, 10, app.early).await);

    assert_eq!(app.post(&format!("/open-shifts/{id}/close"), &app.viewer(&app.anna), None, None).await.0, 403);
    let (status, closed) = app.post(&format!("/open-shifts/{id}/close"), &app.planner(), None, None).await;
    assert_eq!((status, closed["status"].as_str()), (200, Some("closed")));
    assert_eq!(app.post(&format!("/open-shifts/{id}/volunteer"), &app.viewer(&app.anna), None, None).await.0, 409);
    assert_eq!(app.post(&format!("/open-shifts/{id}/close"), &app.planner(), None, None).await.0, 409);

    let (_, open) = app.get("/open-shifts", &app.viewer(&app.anna)).await;
    assert_eq!(open, json!([]));
    let (_, closed) = app.get("/open-shifts?status=closed", &app.planner()).await;
    assert_eq!(closed.as_array().unwrap().len(), 1);
    let (_, count) = app.get("/open-shifts/count", &app.viewer(&app.anna)).await;
    assert_eq!(count["count"], 0);

    // A closed slot can be offered again.
    post(&app, 10, app.early).await;
    let (_, count) = app.get("/open-shifts/count", &app.viewer(&app.anna)).await;
    assert_eq!(count["count"], 1);
    app.cleanup();
}

#[tokio::test]
async fn gaps_list_the_slots_below_a_wards_minimum_that_are_not_offered_yet() {
    let app = app!();
    give_times(&app, app.early, 6, 14);
    let ward = ward(&app, 2);
    // One person on the early shift on the 10th, nobody on the 11th.
    {
        app.roster(app.anna.id, day(10), Some(app.early));
        let mut conn = app.pool.get().unwrap();
        diesel::update(shift::schema::confirmed_shift_plans::table.filter(shift::schema::confirmed_shift_plans::employee_id.eq(app.anna.id)))
            .set(shift::schema::confirmed_shift_plans::workstation_id.eq(Some(ward)))
            .execute(&mut conn)
            .unwrap();
    }
    let path = format!("/open-shifts/gaps?from={}&to={}", day(10), day(11));

    assert_eq!(app.get(&path, &app.viewer(&app.anna)).await.0, 403);
    let (status, gaps) = app.get(&path, &app.planner()).await;
    assert_eq!(status, 200, "{gaps}");
    let gaps = gaps.as_array().unwrap();
    assert_eq!(gaps.len(), 2, "{gaps:?}");
    assert_eq!((gaps[0]["date"].as_str(), gaps[0]["short"].as_i64()), (Some(day(10).to_string().as_str()), Some(1)));
    assert_eq!((gaps[1]["date"].as_str(), gaps[1]["short"].as_i64()), (Some(day(11).to_string().as_str()), Some(2)));
    assert_eq!(gaps[0]["workstation_id"], ward.to_string());

    // Offering the first one takes it off the list.
    let offer = json!({ "date": day(10).to_string(), "shift_id": app.early, "workstation_id": ward });
    assert_eq!(app.post("/open-shifts", &app.planner(), Some(offer), None).await.0, 200);
    let (_, gaps) = app.get(&path, &app.planner()).await;
    assert_eq!(gaps.as_array().unwrap().len(), 1);

    let too_long = format!("/open-shifts/gaps?from={}&to={}", day(0), day(200));
    assert_eq!(app.get(&too_long, &app.planner()).await.0, 400);
    drop_wards(&app);
    app.cleanup();
}

#[tokio::test]
async fn an_offer_mails_only_the_people_who_may_take_it() {
    let mailer = Arc::new(RecordingMailer::default());
    let Some(app) = TestApp::spawn_with_mailer("open-shifts-mail", Some(mailer)).await else { return };
    may_work(&app, app.anna.id, app.early); // Ben may not

    let id = id_of(&post(&app, 10, app.early).await);
    let mut conn = app.pool.get().unwrap();
    let queued: Vec<(String, String)> = notification_outbox::table
        .filter(notification_outbox::tenant_id.eq(&app.tenant))
        .select((notification_outbox::recipient, notification_outbox::event))
        .load(&mut conn)
        .unwrap();
    assert_eq!(queued, vec![(app.anna.email.clone(), "open_shift_offered".to_string())], "Ben may not take it, so he is not asked");
    drop(conn);

    let (status, body) = app.post(&format!("/open-shifts/{id}/assign"), &app.planner(), Some(json!({ "employee_id": app.anna.id })), None).await;
    assert_eq!(status, 200, "{body}");
    let mut conn = app.pool.get().unwrap();
    let subjects: Vec<String> = notification_outbox::table
        .filter(notification_outbox::tenant_id.eq(&app.tenant))
        .order(notification_outbox::created_at.asc())
        .select(notification_outbox::subject)
        .load(&mut conn)
        .unwrap();
    assert_eq!(subjects.len(), 2);
    assert!(subjects[1].starts_with("You have the open shift"), "{subjects:?}");
    drop(conn);
    drop_wards(&app);
    app.cleanup();
}
