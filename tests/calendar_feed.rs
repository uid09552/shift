//! End-to-end tests for the calendar feed: making, replacing and removing the
//! link (`/calendar-feed`), and what the public feed (`/calendar-feeds/<token>.ics`)
//! holds — published and locked months only, shifts only, nobody else's.
//!
//! Needs PostgreSQL (`DATABASE_URL`, or the development default); without one
//! the tests print a notice and pass.

mod common;
mod roster_support;

use chrono::{Datelike, NaiveTime};
use diesel::prelude::*;
use serde_json::Value;

use roster_support::{day, TestApp};
use shift::schema::shift_weekday_times;

macro_rules! app {
    () => {
        match TestApp::spawn("calendar").await {
            Some(app) => app,
            None => return,
        }
    };
}

/// The feed at `path`, fetched without any token header — as a calendar app would.
async fn fetch(app: &TestApp, path: &str) -> (u16, String, String) {
    let base = app.base_url.trim_end_matches("/api/v1");
    let response = reqwest::get(format!("{base}{path}")).await.expect("request");
    let status = response.status().as_u16();
    let kind = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    (status, kind, response.text().await.unwrap_or_default())
}

async fn make_link(app: &TestApp) -> Value {
    let (status, body) = app.post("/calendar-feed", &app.viewer(&app.anna), None, None).await;
    assert_eq!(status, 200, "{body}");
    body
}

fn early_runs_six_to_two(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    for weekday in 0..7i16 {
        diesel::insert_into(shift_weekday_times::table)
            .values((
                shift_weekday_times::shift_id.eq(app.early),
                shift_weekday_times::weekday.eq(weekday),
                shift_weekday_times::start_time.eq(NaiveTime::from_hms_opt(6, 0, 0).unwrap()),
                shift_weekday_times::end_time.eq(NaiveTime::from_hms_opt(14, 0, 0).unwrap()),
                shift_weekday_times::min_employees.eq(1i16),
                shift_weekday_times::free_days_after_shift.eq(0i16),
                shift_weekday_times::tenant_id.eq(&app.tenant),
            ))
            .execute(&mut conn)
            .unwrap();
    }
}

fn cleanup(app: &TestApp) {
    let mut conn = app.pool.get().unwrap();
    let _ = diesel::delete(shift_weekday_times::table.filter(shift_weekday_times::tenant_id.eq(&app.tenant))).execute(&mut conn);
    drop(conn);
    app.cleanup();
}

fn ics_day(date: chrono::NaiveDate) -> String {
    format!("{:04}{:02}{:02}", date.year(), date.month(), date.day())
}

#[tokio::test]
async fn the_link_is_shown_once_and_is_the_callers_own() {
    let app = app!();
    let (status, before) = app.get("/calendar-feed", &app.viewer(&app.anna)).await;
    assert_eq!((status, before["active"].as_bool()), (200, Some(false)));

    let made = make_link(&app).await;
    let token = made["token"].as_str().unwrap();
    assert_eq!(token.len(), 64);
    assert_eq!(made["path"], format!("/api/v1/calendar-feeds/{token}.ics"));

    let (_, after) = app.get("/calendar-feed", &app.viewer(&app.anna)).await;
    assert_eq!(after["active"], true);
    assert!(after.get("token").is_none() && after.get("path").is_none(), "never shown again: {after}");
    let (_, ben) = app.get("/calendar-feed", &app.viewer(&app.ben)).await;
    assert_eq!(ben["active"], false, "Ben's is his own");

    let stranger = app.token(&["shift-viewer"], "nobody@test.invalid");
    assert_eq!(app.post("/calendar-feed", &stranger, None, None).await.0, 400, "no employee, no roster to subscribe to");
    cleanup(&app);
}

#[tokio::test]
async fn the_feed_holds_the_published_shifts_and_nothing_else() {
    let app = app!();
    early_runs_six_to_two(&app);
    // A published shift, a published absence, a draft-month shift and Ben's shift.
    let published = day(10);
    app.set_month(published, "published");
    app.roster(app.anna.id, published, Some(app.early));
    app.roster(app.anna.id, published + chrono::Duration::days(1), None);
    let draft = day(75);
    assert_ne!((draft.year(), draft.month()), (published.year(), published.month()));
    app.roster(app.anna.id, draft, Some(app.early));
    app.roster(app.ben.id, published, Some(app.early));

    let path = make_link(&app).await["path"].as_str().unwrap().to_string();
    let (status, kind, ics) = fetch(&app, &path).await;
    assert_eq!(status, 200, "{ics}");
    assert!(kind.starts_with("text/calendar"), "{kind}");
    assert!(ics.starts_with("BEGIN:VCALENDAR\r\n") && ics.ends_with("END:VCALENDAR\r\n"));

    assert_eq!(ics.matches("BEGIN:VEVENT").count(), 1, "one published shift: {ics}");
    assert!(ics.contains(&format!("DTSTART:{}T060000\r\n", ics_day(published))), "{ics}");
    assert!(ics.contains(&format!("DTEND:{}T140000\r\n", ics_day(published))));
    assert!(ics.contains("SUMMARY:Early\r\n"));
    assert!(!ics.contains(&ics_day(draft)), "a draft month is not in it");

    let (_, info) = app.get("/calendar-feed", &app.viewer(&app.anna)).await;
    assert!(info["last_fetched_at"].is_string(), "the fetch is recorded: {info}");
    cleanup(&app);
}

#[tokio::test]
async fn a_new_link_or_removing_it_stops_the_old_one() {
    let app = app!();
    let first = make_link(&app).await["path"].as_str().unwrap().to_string();
    assert_eq!(fetch(&app, &first).await.0, 200);

    let second = make_link(&app).await["path"].as_str().unwrap().to_string();
    assert_ne!(first, second);
    assert_eq!(fetch(&app, &first).await.0, 404, "the old link is revoked");
    assert_eq!(fetch(&app, &second).await.0, 200);

    let (status, body) = app.delete("/calendar-feed", &app.viewer(&app.anna), None).await;
    assert_eq!((status, body["active"].as_bool()), (200, Some(false)));
    assert_eq!(fetch(&app, &second).await.0, 404);
    assert_eq!(app.delete("/calendar-feed", &app.viewer(&app.anna), None).await.0, 404, "nothing left to remove");
    cleanup(&app);
}

#[tokio::test]
async fn an_unknown_or_malformed_token_finds_nothing() {
    let app = app!();
    make_link(&app).await;
    for path in [
        format!("/api/v1/calendar-feeds/{}.ics", "a".repeat(64)),
        "/api/v1/calendar-feeds/not-a-token.ics".to_string(),
        "/api/v1/calendar-feeds/".to_string(),
    ] {
        let status = fetch(&app, &path).await.0;
        assert!(status == 404 || status == 405, "{path}: {status}");
    }
    cleanup(&app);
}
