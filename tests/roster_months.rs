//! End-to-end tests for `/roster-months`: who may publish, unpublish, unlock
//! and lock a month, that reverting needs a reason and is audited, the publish
//! deadline, and that statuses stay within their tenant.

mod common;
mod roster_support;

use chrono::Duration;
use diesel::prelude::*;
use serde_json::Value;

use roster_support::{day, first_of, ym, TestApp};
use shift::models::NewPlannerSettings;
use shift::schema::{audit_logs, planner_settings};

macro_rules! app {
    () => {
        match TestApp::spawn("roster-months").await {
            Some(app) => app,
            None => return,
        }
    };
}

fn next_month() -> chrono::NaiveDate {
    first_of(first_of(day(0)) + Duration::days(40))
}

fn last_month() -> chrono::NaiveDate {
    first_of(first_of(day(0)) - Duration::days(1))
}

fn month_in<'a>(list: &'a Value, month: &str) -> &'a Value {
    list.as_array()
        .and_then(|l| l.iter().find(|m| m["month"] == month))
        .unwrap_or_else(|| panic!("{month} not in {list}"))
}

#[tokio::test]
async fn a_planner_publishes_a_draft_month_once() {
    let app = app!();
    let month = ym(next_month());

    let (status, list) = app.get(&format!("/roster-months?from={month}&to={month}"), &app.planner()).await;
    assert_eq!(status, 200, "{list}");
    assert_eq!(month_in(&list, &month)["status"], "draft", "a month nobody touched is draft");

    let (status, body) = app.post(&format!("/roster-months/{month}/publish"), &app.planner(), None, None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["status"], "published");
    assert_eq!(body["published_by"], "planner@test.invalid");
    assert!(body["published_at"].is_string());

    let (status, body) = app.post(&format!("/roster-months/{month}/publish"), &app.planner(), None, None).await;
    assert_eq!(status, 409, "publishing twice is a conflict: {body}");

    app.cleanup();
}

#[tokio::test]
async fn a_viewer_changes_no_month_status() {
    let app = app!();
    let month = ym(next_month());

    let (status, _) = app.post(&format!("/roster-months/{month}/publish"), &app.viewer(&app.anna), None, None).await;
    assert_eq!(status, 403);
    let (_, list) = app.get(&format!("/roster-months?from={month}&to={month}"), &app.viewer(&app.anna)).await;
    assert_eq!(month_in(&list, &month)["status"], "draft", "but may read it");

    app.cleanup();
}

#[tokio::test]
async fn only_an_admin_unpublishes_and_only_with_a_reason() {
    let app = app!();
    let month = ym(next_month());
    app.set_month(next_month(), "published");
    let path = format!("/roster-months/{month}/unpublish");

    let (status, _) = app.post(&path, &app.planner(), None, Some("mistake")).await;
    assert_eq!(status, 403, "a planner may not unpublish");

    let (status, body) = app.post(&path, &app.admin(), None, None).await;
    assert_eq!(status, 428, "{body}");
    assert_eq!(body["code"], "reason_required");

    let (status, body) = app.post(&path, &app.admin(), None, Some("Published the wrong draft")).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["status"], "draft");

    let mut conn = app.pool.get().unwrap();
    let changes: Vec<Option<String>> = audit_logs::table
        .filter(audit_logs::tenant_id.eq(&app.tenant))
        .filter(audit_logs::action.eq("roster_month.unpublish"))
        .select(audit_logs::changes)
        .load(&mut conn)
        .unwrap();
    assert_eq!(changes.len(), 1);
    assert!(changes[0].as_deref().unwrap().contains("Published the wrong draft"), "the reason is audited");
    drop(conn);

    app.cleanup();
}

#[tokio::test]
async fn an_admin_unlocks_a_past_month_and_it_stays_open_until_locked_again() {
    let app = app!();
    let past = last_month();
    let month = ym(past);
    app.set_month(past, "published"); // over, so it reads as locked

    let (_, list) = app.get(&format!("/roster-months?from={month}&to={month}"), &app.planner()).await;
    assert_eq!(month_in(&list, &month)["status"], "locked", "a published month locks itself once it is over");

    let (status, _) = app.post(&format!("/roster-months/{month}/unlock"), &app.planner(), None, Some("fix")).await;
    assert_eq!(status, 403, "a planner may not unlock");
    let (status, _) = app.post(&format!("/roster-months/{month}/unlock"), &app.admin(), None, None).await;
    assert_eq!(status, 428, "no reason, no unlock");

    let (status, body) = app.post(&format!("/roster-months/{month}/unlock"), &app.admin(), None, Some("Late sick note")).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["status"], "published");
    assert_eq!(body["reopened"], true);

    let (_, list) = app.get(&format!("/roster-months?from={month}&to={month}"), &app.planner()).await;
    assert_eq!(month_in(&list, &month)["status"], "published", "stays open although it is over");

    let (status, body) = app.post(&format!("/roster-months/{month}/lock"), &app.admin(), None, None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["status"], "locked");

    app.cleanup();
}

#[tokio::test]
async fn a_month_that_has_not_ended_cannot_be_locked() {
    let app = app!();
    let month = ym(next_month());
    app.set_month(next_month(), "published");

    let (status, body) = app.post(&format!("/roster-months/{month}/lock"), &app.admin(), None, None).await;
    assert_eq!(status, 409, "{body}");

    app.cleanup();
}

#[tokio::test]
async fn a_draft_month_inside_the_lead_days_is_due_and_a_published_one_is_not() {
    let app = app!();
    {
        let mut settings = NewPlannerSettings::defaults(&app.tenant);
        settings.publish_lead_days = 60; // next month always starts within 60 days
        let mut conn = app.pool.get().unwrap();
        diesel::insert_into(planner_settings::table).values(&settings).execute(&mut conn).unwrap();
    }
    let this = ym(day(0));
    let next = ym(next_month());

    let (status, list) = app.get(&format!("/roster-months?from={this}&to={next}"), &app.planner()).await;
    assert_eq!(status, 200, "{list}");
    assert_eq!(month_in(&list, &next)["deadline"], "due");
    assert_eq!(month_in(&list, &this)["deadline"], "overdue", "this month has started unpublished");

    app.set_month(next_month(), "published");
    let (_, list) = app.get(&format!("/roster-months?from={this}&to={next}"), &app.planner()).await;
    assert_eq!(month_in(&list, &next)["deadline"], Value::Null, "published: no warning");

    app.cleanup();
}

#[tokio::test]
async fn month_statuses_stay_within_their_tenant() {
    let app = app!();
    let month = ym(next_month());
    app.set_month(next_month(), "published");

    let other = app.keys.sign(serde_json::json!({
        "sub": "planner@other.invalid",
        "tenant": [format!("{}-other", app.tenant)],
        "realm_access": { "roles": ["shift-planner"] },
        "email": "planner@other.invalid",
    }));
    let (_, list) = app.get(&format!("/roster-months?from={month}&to={month}"), &other).await;
    assert_eq!(month_in(&list, &month)["status"], "draft", "another tenant's publication is not theirs");

    app.cleanup();
}

#[tokio::test]
async fn a_malformed_month_is_refused() {
    let app = app!();
    let (status, _) = app.post("/roster-months/2026-13/publish", &app.planner(), None, None).await;
    assert_eq!(status, 400);
    app.cleanup();
}
