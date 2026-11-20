//! End-to-end tests for e-mail notifications: the preferences API, that events
//! queue mail only when a mailer is configured and the employee wants it, that
//! delivery retries and gives up, and that roster changes are announced once, as
//! one mail per employee, and never for history.
//!
//! Mail goes to a `RecordingMailer` instead of an SMTP server; the worker's
//! steps (`announce_roster_changes`, `deliver_due`) are called directly so no
//! test waits for a timer. Needs PostgreSQL (`DATABASE_URL`, or the development
//! default); without one the tests print a notice and pass.

mod common;
mod roster_support;

use std::sync::Arc;

use chrono::{Duration, Utc};
use diesel::prelude::*;
use serde_json::{json, Value};

use roster_support::{day, Person, TestApp};
use shift::schema::{notification_outbox, roster_change_notices, roster_notice_deliveries};
use shift::services::notifier::{self, RecordingMailer, MAX_ATTEMPTS};

/// The outbox worker takes due mail of every tenant — as it should in production —
/// so two tests delivering at once would send each other's messages through their
/// own mailers. One test at a time.
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn app_with_mail(label: &str) -> Option<(TestApp, Arc<RecordingMailer>)> {
    let mailer = Arc::new(RecordingMailer::default());
    let app = TestApp::spawn_with_mailer(label, Some(mailer.clone())).await?;
    forget_other_tests_mail(&app);
    Some((app, mailer))
}

/// Mail a test that failed before its cleanup left behind would be delivered
/// along with ours; it is nobody's business here.
fn forget_other_tests_mail(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    let _ = diesel::delete(
        notification_outbox::table
            .filter(notification_outbox::tenant_id.like("test-%"))
            .filter(notification_outbox::tenant_id.ne(&app.tenant)),
    )
    .execute(&mut conn);
}

/// What `mailer` sent to `who` — other tests' mail is not ours to count.
fn sent_to(mailer: &RecordingMailer, who: &Person) -> Vec<(String, String, String)> {
    mailer.sent.lock().unwrap().iter().filter(|m| m.0 == who.email).cloned().collect()
}

/// `(recipient, event, subject, status, attempts)` of every queued mail, oldest first.
fn outbox(app: &TestApp) -> Vec<(String, String, String, String, i32)> {
    let mut conn = app.pool.get().unwrap();
    notification_outbox::table
        .filter(notification_outbox::tenant_id.eq(&app.tenant))
        .order(notification_outbox::created_at.asc())
        .select((
            notification_outbox::recipient,
            notification_outbox::event,
            notification_outbox::subject,
            notification_outbox::status,
            notification_outbox::attempts,
        ))
        .load(&mut conn)
        .unwrap()
}

fn events_for(app: &TestApp, who: &Person) -> Vec<String> {
    outbox(app).into_iter().filter(|m| m.0 == who.email).map(|m| m.1).collect()
}

fn leave_body(who: &Person, from: i64, to: i64) -> Value {
    json!({ "employee_id": who.id, "start_date": day(from).to_string(), "end_date": day(to).to_string() })
}

/// Anna asks for leave and a planner approves it — an event that mails Anna.
async fn anna_gets_leave(app: &TestApp, from: i64, to: i64) {
    let (status, created) = app.post("/leave-requests", &app.viewer(&app.anna), Some(leave_body(&app.anna, from, to)), None).await;
    assert_eq!(status, 200, "{created}");
    let id = created["id"].as_str().unwrap();
    let (status, body) = app.post(&format!("/leave-requests/{id}/approve"), &app.planner(), Some(json!({})), None).await;
    assert_eq!(status, 200, "{body}");
}

#[tokio::test]
async fn preferences_default_to_everything_on_and_are_the_callers_own() {
    let _serial = SERIAL.lock().await;
    let Some((app, _)) = app_with_mail("notify-prefs").await else { return };

    let (status, body) = app.get("/notification-preferences", &app.viewer(&app.anna)).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["email_enabled"], true);
    assert_eq!(body["muted_events"], json!([]));
    assert_eq!(body["employee_id"], app.anna.id.to_string());
    assert_eq!(body["email_configured"], true);
    assert_eq!(body["events"].as_array().unwrap().len(), 5);

    let mute = json!({ "email_enabled": true, "muted_events": ["leave_update", "swap_update", "leave_update"] });
    let (status, saved) = app.put("/notification-preferences", &app.viewer(&app.anna), mute, None).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["muted_events"], json!(["leave_update", "swap_update"]), "sorted, without duplicates");

    let (_, ben) = app.get("/notification-preferences", &app.viewer(&app.ben)).await;
    assert_eq!(ben["muted_events"], json!([]), "Ben's are his own");
    let (_, again) = app.get("/notification-preferences", &app.viewer(&app.anna)).await;
    assert_eq!(again["muted_events"], json!(["leave_update", "swap_update"]));

    let unknown = json!({ "email_enabled": true, "muted_events": ["birthday"] });
    assert_eq!(app.put("/notification-preferences", &app.viewer(&app.anna), unknown, None).await.0, 400);

    // Someone without an employee record has nothing to set.
    let stranger = app.token(&["shift-viewer"], "nobody@test.invalid");
    let (status, body) = app.get("/notification-preferences", &stranger).await;
    assert_eq!((status, body["employee_id"].is_null()), (200, true));
    assert_eq!(app.put("/notification-preferences", &stranger, json!({ "email_enabled": false }), None).await.0, 400);
    app.cleanup();
}

#[tokio::test]
async fn nothing_is_queued_without_a_mailer() {
    let _serial = SERIAL.lock().await;
    let Some(app) = TestApp::spawn("notify-off").await else { return };
    anna_gets_leave(&app, 30, 31).await;
    assert!(outbox(&app).is_empty(), "no smtp.host, no mail");
    let (_, prefs) = app.get("/notification-preferences", &app.viewer(&app.anna)).await;
    assert_eq!(prefs["email_configured"], false, "the page can say so");
    app.cleanup();
}

#[tokio::test]
async fn a_decision_queues_one_mail_for_the_person_it_concerns() {
    let _serial = SERIAL.lock().await;
    let Some((app, mailer)) = app_with_mail("notify-leave").await else { return };
    anna_gets_leave(&app, 30, 31).await;

    let queued = outbox(&app);
    assert_eq!(queued.len(), 1, "{queued:?}");
    let (to, event, subject, status, _) = &queued[0];
    assert_eq!((to.as_str(), event.as_str(), status.as_str()), (app.anna.email.as_str(), "leave_update", "pending"));
    assert!(subject.contains("approved") && subject.contains(&day(30).to_string()), "{subject}");

    notifier::deliver_due(&app.state, Utc::now().naive_utc()).await;
    let sent = sent_to(&mailer, &app.anna);
    assert_eq!(sent.len(), 1);
    assert!(sent[0].2.contains("https://shift.test/leave"), "links to the app: {}", sent[0].2);
    assert!(sent[0].2.contains("https://shift.test/notifications"), "and to where it can be turned off");
    let queued = outbox(&app);
    assert_eq!((queued[0].3.as_str(), queued[0].4), ("sent", 1));
    notifier::deliver_due(&app.state, Utc::now().naive_utc()).await;
    assert_eq!(sent_to(&mailer, &app.anna).len(), 1, "sent mail is not sent twice");
    app.cleanup();
}

#[tokio::test]
async fn a_muted_event_or_a_switched_off_channel_queues_nothing() {
    let _serial = SERIAL.lock().await;
    let Some((app, _)) = app_with_mail("notify-mute").await else { return };

    let mute = json!({ "email_enabled": true, "muted_events": ["leave_update"] });
    assert_eq!(app.put("/notification-preferences", &app.viewer(&app.anna), mute, None).await.0, 200);
    anna_gets_leave(&app, 30, 31).await;
    assert!(events_for(&app, &app.anna).is_empty(), "Anna muted leave mail");

    let off = json!({ "email_enabled": false, "muted_events": [] });
    assert_eq!(app.put("/notification-preferences", &app.viewer(&app.anna), off, None).await.0, 200);
    anna_gets_leave(&app, 35, 36).await;
    assert!(events_for(&app, &app.anna).is_empty(), "and then switched the channel off");

    let on = json!({ "email_enabled": true, "muted_events": [] });
    assert_eq!(app.put("/notification-preferences", &app.viewer(&app.anna), on, None).await.0, 200);
    anna_gets_leave(&app, 40, 41).await;
    assert_eq!(events_for(&app, &app.anna), vec!["leave_update"], "back on");
    app.cleanup();
}

#[tokio::test]
async fn a_failing_mail_is_retried_with_a_delay_and_then_given_up() {
    let _serial = SERIAL.lock().await;
    let Some((app, mailer)) = app_with_mail("notify-retry").await else { return };
    anna_gets_leave(&app, 30, 31).await;
    *mailer.fail_with.lock().unwrap() = Some("connection refused".into());

    let mut now = Utc::now().naive_utc();
    for attempt in 1..=MAX_ATTEMPTS {
        notifier::deliver_due(&app.state, now).await;
        let queued = outbox(&app);
        let expected = if attempt < MAX_ATTEMPTS { "pending" } else { "failed" };
        assert_eq!((queued[0].3.as_str(), queued[0].4), (expected, attempt), "after attempt {attempt}");
        if attempt < MAX_ATTEMPTS {
            // Not due again straight away; due once the back-off has passed.
            notifier::deliver_due(&app.state, now).await;
            assert_eq!(outbox(&app)[0].4, attempt, "backing off: not tried again before the delay has passed");
            now += notifier::backoff(attempt) + Duration::seconds(1);
        }
    }
    notifier::deliver_due(&app.state, now + Duration::days(1)).await;
    assert_eq!(outbox(&app)[0].4, MAX_ATTEMPTS, "a failed mail is not tried again");

    let mut conn = app.pool.get().unwrap();
    let error: Option<String> = notification_outbox::table
        .filter(notification_outbox::tenant_id.eq(&app.tenant))
        .select(notification_outbox::last_error)
        .first(&mut conn)
        .unwrap();
    assert_eq!(error.as_deref(), Some("connection refused"), "the reason is kept");
    drop(conn);

    // The action that raised the event was never affected.
    let (_, leave) = app.get("/leave-requests?status=approved", &app.planner()).await;
    assert_eq!(leave.as_array().unwrap().len(), 1);

    let (status, rows) = app.get("/notification-outbox", &app.planner()).await;
    assert_eq!((status, rows.as_array().map(Vec::len)), (200, Some(1)));
    assert_eq!(rows[0]["status"], "failed");
    assert_eq!(app.get("/notification-outbox", &app.viewer(&app.anna)).await.0, 403, "other people's addresses");
    app.cleanup();
}

#[tokio::test]
async fn publishing_a_month_tells_everyone_who_works_in_it() {
    let _serial = SERIAL.lock().await;
    let Some((app, _)) = app_with_mail("notify-publish").await else { return };
    let month_day = day(60);
    app.roster(app.anna.id, month_day, Some(app.early));
    app.roster(app.anna.id, month_day + Duration::days(1), Some(app.early));
    app.roster(app.ben.id, month_day, None); // a day off is not a shift

    let month = roster_support::ym(month_day);
    let (status, body) = app.post(&format!("/roster-months/{month}/publish"), &app.planner(), None, None).await;
    assert_eq!(status, 200, "{body}");

    assert_eq!(events_for(&app, &app.anna), vec!["roster_published"], "one mail, not one per day");
    assert!(events_for(&app, &app.ben).is_empty(), "Ben has no shift in it");
    assert!(outbox(&app)[0].2.starts_with("Roster published:"));
    app.cleanup();
}

/// A published month with a change in it: Anna's early shift on `offset` is
/// replaced by a late one, by hand, with a reason.
async fn change_anna(app: &TestApp, offset: i64) {
    app.set_month(day(offset), "published");
    let row = app.roster(app.anna.id, day(offset), Some(app.early));
    let (status, body) = app
        .put(&format!("/confirmed-shift-plans/{row}"), &app.planner(), json!({ "shift_id": app.late }), Some("Cover"))
        .await;
    assert_eq!(status, 200, "{body}");
}

fn notice_count(app: &TestApp) -> i64 {
    let mut conn = app.pool.get().unwrap();
    roster_change_notices::table
        .filter(roster_change_notices::tenant_id.eq(&app.tenant))
        .count()
        .get_result(&mut conn)
        .unwrap()
}

#[tokio::test]
async fn roster_changes_are_announced_once_as_one_mail_per_employee() {
    let _serial = SERIAL.lock().await;
    let Some((app, mailer)) = app_with_mail("notify-notices").await else { return };
    change_anna(&app, 20).await;
    change_anna(&app, 21).await;
    assert_eq!(notice_count(&app), 2);

    notifier::announce_roster_changes(&app.state, Utc::now().naive_utc()).await;
    let queued = outbox(&app);
    assert_eq!(queued.len(), 1, "two days, one mail: {queued:?}");
    assert_eq!((queued[0].0.as_str(), queued[0].1.as_str()), (app.anna.email.as_str(), "shift_changed"));
    assert!(queued[0].2.contains("2 days"), "{}", queued[0].2);

    notifier::announce_roster_changes(&app.state, Utc::now().naive_utc()).await;
    assert_eq!(outbox(&app).len(), 1, "the same notices are never announced twice");

    notifier::deliver_due(&app.state, Utc::now().naive_utc()).await;
    let body = sent_to(&mailer, &app.anna)[0].2.clone();
    let (first, second) = (day(20).to_string(), day(21).to_string());
    assert!(body.contains(&format!("{first}: Early -> Late")), "{body}");
    assert!(body.contains(&format!("{second}: Early -> Late")), "{body}");

    // A later change is a new mail.
    change_anna(&app, 22).await;
    notifier::announce_roster_changes(&app.state, Utc::now().naive_utc()).await;
    assert_eq!(outbox(&app).len(), 2);
    app.cleanup();
}

#[tokio::test]
async fn switching_mail_on_does_not_announce_history() {
    let _serial = SERIAL.lock().await;
    let Some((app, _)) = app_with_mail("notify-history").await else { return };
    change_anna(&app, 20).await;

    // A notice from long ago, written while mail was off.
    {
        let mut conn = app.pool.get().unwrap();
        diesel::update(roster_change_notices::table.filter(roster_change_notices::tenant_id.eq(&app.tenant)))
            .set(roster_change_notices::created_at.eq(Utc::now().naive_utc() - Duration::days(30)))
            .execute(&mut conn)
            .unwrap();
    }
    notifier::announce_roster_changes(&app.state, Utc::now().naive_utc()).await;
    assert!(outbox(&app).is_empty(), "too old to announce");

    let mut conn = app.pool.get().unwrap();
    let handled: i64 = roster_notice_deliveries::table
        .inner_join(roster_change_notices::table)
        .filter(roster_change_notices::tenant_id.eq(&app.tenant))
        .count()
        .get_result(&mut conn)
        .unwrap();
    assert_eq!(handled, 1, "but marked as handled, so it is not looked at again");
    drop(conn);
    app.cleanup();
}

#[tokio::test]
async fn a_muted_change_notice_is_handled_without_mail() {
    let _serial = SERIAL.lock().await;
    let Some((app, _)) = app_with_mail("notify-notice-mute").await else { return };
    let mute = json!({ "email_enabled": true, "muted_events": ["shift_changed"] });
    assert_eq!(app.put("/notification-preferences", &app.viewer(&app.anna), mute, None).await.0, 200);
    change_anna(&app, 20).await;
    notifier::announce_roster_changes(&app.state, Utc::now().naive_utc()).await;
    assert!(outbox(&app).is_empty());
    app.cleanup();
}

#[tokio::test]
async fn a_swap_tells_each_person_as_it_moves() {
    let _serial = SERIAL.lock().await;
    let Some((app, _)) = app_with_mail("notify-swap").await else { return };
    let date = day(30);
    app.set_month(date, "published");
    app.roster(app.anna.id, date, Some(app.early));
    app.roster(app.ben.id, date, Some(app.late));

    let request = json!({
        "requester_id": app.anna.id, "requester_date": date.to_string(),
        "colleague_id": app.ben.id, "colleague_date": date.to_string(),
    });
    let (status, swap) = app.post("/shift-swaps", &app.viewer(&app.anna), Some(request), None).await;
    assert_eq!(status, 200, "{swap}");
    let id = swap["id"].as_str().unwrap();
    assert_eq!(events_for(&app, &app.ben), vec!["swap_update"], "Ben is asked");
    assert!(events_for(&app, &app.anna).is_empty());
    assert!(outbox(&app)[0].2.contains("asks to swap"), "{:?}", outbox(&app)[0]);

    assert_eq!(app.post(&format!("/shift-swaps/{id}/accept"), &app.viewer(&app.ben), None, None).await.0, 200);
    assert_eq!(events_for(&app, &app.anna), vec!["swap_update"], "Anna hears that Ben said yes");

    let (status, body) = app.post(&format!("/shift-swaps/{id}/approve"), &app.planner(), None, None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(events_for(&app, &app.anna).len(), 2, "and that a planner approved");
    assert_eq!(events_for(&app, &app.ben).len(), 2);
    app.cleanup();
}
