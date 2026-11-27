//! A personal calendar feed (iCal, RFC 5545) per employee, so their shifts show
//! up in the calendar on their phone.
//!
//! Calendar apps subscribe to `GET /api/v1/calendar-feeds/<token>.ics` and
//! cannot sign in, so that route sits outside the authentication middleware and
//! the token is the only key: 256 random bits, of which only the SHA-256 is
//! stored. The link is therefore shown once, when it is made; making a new one
//! revokes the old, and so does deleting it.
//!
//! The feed holds exactly what the employee has been told: their confirmed
//! shifts in **published and locked** months, from a month back to a year ahead.
//! Draft months never appear. Absences are left out — a shared calendar should
//! not say why someone is off. Times are floating local times (no time zone),
//! which every calendar app shows as written: the hospital's own clock.
//!
//! | endpoint                         | who                         |
//! |----------------------------------|-----------------------------|
//! | `GET/POST/DELETE /calendar-feed` | the caller, for themselves  |
//! | `GET /calendar-feeds/<token>.ics`| anyone holding the token    |

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{Duration, NaiveDate, NaiveDateTime, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::domain::{
    CalendarFeedRepository, ConfirmedShiftPlanRepository, Shift, ShiftRepository, WorkstationRepository,
};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::open_shift::shift_span;
use crate::services::shift_swap::{actor_name, caller_employee, today};
use crate::services::tenant::{TenantContext, UserContext};

/// Where the feed is served, before the token.
pub const FEED_PATH: &str = "/api/v1/calendar-feeds/";

/// How far back and ahead the feed reaches.
const DAYS_BACK: i64 = 31;
const DAYS_AHEAD: i64 = 366;

/// A new token: two v4 UUIDs, 244 random bits, as 64 hex characters.
fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// The token in `<token>.ics` (or a bare token), if it looks like one of ours.
pub fn token_from_file(file: &str) -> Option<&str> {
    let token = file.strip_suffix(".ics").unwrap_or(file);
    (token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit())).then_some(token)
}

// --- iCalendar ------------------------------------------------------------------

/// When an event happens: at set times, or on a whole day.
#[derive(Debug, Clone, PartialEq)]
pub enum When {
    Timed(NaiveDateTime, NaiveDateTime),
    AllDay(NaiveDate),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub uid: String,
    pub when: When,
    pub summary: String,
}

/// TEXT as RFC 5545 §3.3.11 wants it: backslash, semicolon, comma and newline escaped.
pub fn escape_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

/// One content line, folded at 75 octets (§3.1) without splitting a character.
pub fn fold(line: &str) -> String {
    let mut out = String::with_capacity(line.len() + 8);
    let mut width = 0;
    for c in line.chars() {
        let len = c.len_utf8();
        // The first line may hold 75 octets; a continuation starts with a space.
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(c);
        width += len;
    }
    out.push_str("\r\n");
    out
}

fn stamp(at: NaiveDateTime) -> String {
    at.format("%Y%m%dT%H%M%S").to_string()
}

/// The whole calendar.
pub fn render(name: &str, events: &[Event], now: NaiveDateTime) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//ShiftPlanner//Roster//EN".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "METHOD:PUBLISH".to_string(),
        format!("X-WR-CALNAME:{}", escape_text(name)),
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H".to_string(),
        "X-PUBLISHED-TTL:PT1H".to_string(),
    ];
    for event in events {
        lines.push("BEGIN:VEVENT".to_string());
        lines.push(format!("UID:{}", event.uid));
        lines.push(format!("DTSTAMP:{}Z", stamp(now)));
        match &event.when {
            When::Timed(start, end) => {
                lines.push(format!("DTSTART:{}", stamp(*start)));
                lines.push(format!("DTEND:{}", stamp(*end)));
            }
            When::AllDay(day) => {
                lines.push(format!("DTSTART;VALUE=DATE:{}", day.format("%Y%m%d")));
                let next = day.succ_opt().unwrap_or(*day);
                lines.push(format!("DTEND;VALUE=DATE:{}", next.format("%Y%m%d")));
            }
        }
        lines.push(format!("SUMMARY:{}", escape_text(&event.summary)));
        lines.push("TRANSP:OPAQUE".to_string());
        lines.push("END:VEVENT".to_string());
    }
    lines.push("END:VCALENDAR".to_string());
    lines.iter().map(|l| fold(l)).collect()
}

/// The employee's working rows as events: at the shift's times that weekday,
/// or as a whole day when the shift has none.
pub fn events_for(
    rows: &[crate::repository::domain::ConfirmedShiftPlan],
    shifts: &HashMap<Uuid, Shift>,
    workstations: &HashMap<Uuid, String>,
) -> Vec<Event> {
    let mut events: Vec<Event> = rows
        .iter()
        .filter(|r| r.is_working())
        .filter_map(|r| {
            let shift = shifts.get(&r.shift_id?)?;
            let summary = match r.workstation_id.and_then(|w| workstations.get(&w)) {
                Some(ward) => format!("{} · {ward}", shift.name),
                None => shift.name.clone(),
            };
            let when = match shift_span(shift, r.date) {
                Some((start, end)) => When::Timed(start, end),
                None => When::AllDay(r.date),
            };
            Some(Event { uid: format!("{}@shiftplanner", r.id), when, summary })
        })
        .collect();
    events.sort_by_key(|e| match e.when {
        When::Timed(start, _) => start,
        When::AllDay(day) => day.and_hms_opt(0, 0, 0).expect("midnight"),
    });
    events
}

// --- handlers -------------------------------------------------------------------

fn info(feed: Option<&crate::repository::domain::CalendarFeedDomain>, employee: Option<Uuid>) -> Value {
    json!({
        "employee_id": employee,
        "active": feed.is_some(),
        "created_at": feed.map(|f| f.created_at),
        "last_fetched_at": feed.and_then(|f| f.last_fetched_at),
    })
}

pub struct CalendarFeedService;

impl CalendarFeedService {
    /// GET /calendar-feed — whether the caller has a feed. Never the link: it is not stored.
    pub async fn get_feed(
        tenant: TenantContext,
        user: UserContext,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let Some(me) = caller_employee(&state, &tenant, &user).await? else {
            return Ok(Json(info(None, None)));
        };
        let feed = state.calendar_feed_repo.get_feed(&tenant.0, me.id).await?;
        Ok(Json(info(feed.as_ref(), Some(me.id))))
    }

    /// POST /calendar-feed — a new link; any older one stops working. The
    /// answer carries the token and path, the only time they are shown.
    pub async fn create_feed(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let me = caller_employee(&state, &tenant, &user)
            .await?
            .ok_or_else(|| AppError::Validation("No employee matches your account, so there is no roster to subscribe to".into()))?;
        let token = new_token();
        let feed = state.calendar_feed_repo.replace_feed(&tenant.0, me.id, &hash_token(&token)).await?;
        audit_log::record(&state, &tenant.0, actor_name(&actor, &user), "calendar_feed.create", "calendar_feed", Some(me.id.to_string()), None).await;
        let mut body = info(Some(&feed), Some(me.id));
        body["token"] = json!(token);
        body["path"] = json!(format!("{FEED_PATH}{token}.ics"));
        Ok(Json(body))
    }

    /// DELETE /calendar-feed — the link stops working.
    pub async fn delete_feed(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let me = caller_employee(&state, &tenant, &user).await?.ok_or(AppError::NotFound)?;
        if !state.calendar_feed_repo.delete_feed(&tenant.0, me.id).await? {
            return Err(AppError::NotFound);
        }
        audit_log::record(&state, &tenant.0, actor_name(&actor, &user), "calendar_feed.delete", "calendar_feed", Some(me.id.to_string()), None).await;
        Ok(Json(info(None, Some(me.id))))
    }

    /// GET /calendar-feeds/<token>.ics — the feed itself. No sign-in: the token
    /// is the key. An unknown or malformed token is a plain 404.
    pub async fn serve_feed(Path(file): Path<String>, State(state): State<AppState>) -> Result<Response, AppError> {
        let token = token_from_file(&file).ok_or(AppError::NotFound)?;
        let feed = state
            .calendar_feed_repo
            .touch_feed_by_hash(&hash_token(token))
            .await?
            .ok_or(AppError::NotFound)?;
        let tenant = feed.tenant_id.as_str();

        let today = today();
        let rows = state
            .confirmed_shift_plan_repo
            .get_confirmed_shift_plans_for_employee_in_range(
                tenant,
                feed.employee_id,
                today - Duration::days(DAYS_BACK),
                today + Duration::days(DAYS_AHEAD),
                true,
            )
            .await?;
        let shifts: HashMap<Uuid, Shift> = state.shift_repo.list_shifts(tenant).await?.into_iter().map(|s| (s.id, s)).collect();
        let workstations: HashMap<Uuid, String> = state
            .workstation_repo
            .list_workstations(tenant)
            .await?
            .into_iter()
            .map(|w| (w.id, w.name))
            .collect();

        let body = render("My shifts", &events_for(&rows, &shifts, &workstations), Utc::now().naive_utc());
        Ok((
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
                (header::CACHE_CONTROL, "private, max-age=300"),
                (header::CONTENT_DISPOSITION, "inline; filename=\"shifts.ics\""),
            ],
            body,
        )
            .into_response())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::domain::{ConfirmedShiftPlan, WeekdayTime};
    use chrono::NaiveTime;

    fn at(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    fn shift(name: &str, times: Option<(NaiveTime, NaiveTime)>) -> Shift {
        Shift {
            id: Uuid::new_v4(),
            name: name.into(),
            short_name: name[..1].into(),
            color: "#000".into(),
            order: 1,
            break_minutes: 0,
            duty_type: "regular".into(),
            weekday_times: times
                .map(|(start, end)| {
                    (0..7)
                        .map(|weekday| WeekdayTime { weekday, start_time: start, end_time: end, min_employees: 1, max_employees: None, free_days_after_shift: 0 })
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    fn row(date: NaiveDate, shift: Option<&Shift>, ward: Option<Uuid>) -> ConfirmedShiftPlan {
        ConfirmedShiftPlan {
            id: Uuid::new_v4(),
            employee_id: Uuid::new_v4(),
            shift_id: shift.map(|s| s.id),
            workstation_id: ward,
            date,
            is_present: shift.is_some(),
            absence_type: if shift.is_some() { None } else { Some("sick".into()) },
            creation_type: "manual".into(),
            created_at: Default::default(),
            updated_at: Default::default(),
        }
    }

    fn d(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 12, day).unwrap()
    }

    #[test]
    fn text_is_escaped() {
        assert_eq!(escape_text("Early, ICU; a\\b\nline"), "Early\\, ICU\\; a\\\\b\\nline");
    }

    #[test]
    fn long_lines_fold_at_75_octets_without_splitting_a_character() {
        let line = format!("SUMMARY:{}", "ä".repeat(60));
        let folded = fold(&line);
        for part in folded.trim_end_matches("\r\n").split("\r\n") {
            assert!(part.len() <= 75, "{} octets: {part:?}", part.len());
        }
        assert!(folded.split("\r\n").skip(1).filter(|p| !p.is_empty()).all(|p| p.starts_with(' ')));
        let unfolded: String = folded.trim_end_matches("\r\n").replace("\r\n ", "");
        assert_eq!(unfolded, line, "unfolding gives the line back");
    }

    #[test]
    fn a_calendar_is_crlf_lines_with_one_event_per_shift() {
        let early = shift("Early", Some((at(6, 0), at(14, 0))));
        let ward = Uuid::new_v4();
        let shifts = HashMap::from([(early.id, early.clone())]);
        let wards = HashMap::from([(ward, "ICU".to_string())]);
        let rows = [row(d(3), Some(&early), Some(ward)), row(d(4), None, None)];

        let events = events_for(&rows, &shifts, &wards);
        assert_eq!(events.len(), 1, "an absence is not an event");
        assert_eq!(events[0].summary, "Early · ICU");

        let ics = render("My shifts", &events, d(1).and_hms_opt(8, 0, 0).unwrap());
        assert!(ics.starts_with("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
        assert!(ics.ends_with("END:VCALENDAR\r\n"));
        assert!(!ics.replace("\r\n", "").contains('\n'), "only CRLF line ends");
        assert!(ics.contains("DTSTART:20261203T060000\r\n"));
        assert!(ics.contains("DTEND:20261203T140000\r\n"));
        assert!(ics.contains("DTSTAMP:20261201T080000Z\r\n"));
        assert!(ics.contains(&format!("UID:{}@shiftplanner\r\n", rows[0].id)));
    }

    #[test]
    fn a_night_ends_the_next_morning() {
        let night = shift("Night", Some((at(22, 0), at(6, 0))));
        let shifts = HashMap::from([(night.id, night.clone())]);
        let events = events_for(&[row(d(31), Some(&night), None)], &shifts, &HashMap::new());
        let next = NaiveDate::from_ymd_opt(2027, 1, 1).unwrap();
        assert_eq!(events[0].when, When::Timed(d(31).and_time(at(22, 0)), next.and_time(at(6, 0))));
    }

    #[test]
    fn a_shift_without_times_is_a_whole_day() {
        let on_call = shift("On call", None);
        let shifts = HashMap::from([(on_call.id, on_call.clone())]);
        let events = events_for(&[row(d(5), Some(&on_call), None)], &shifts, &HashMap::new());
        let ics = render("My shifts", &events, d(1).and_hms_opt(0, 0, 0).unwrap());
        assert!(ics.contains("DTSTART;VALUE=DATE:20261205\r\n"));
        assert!(ics.contains("DTEND;VALUE=DATE:20261206\r\n"));
    }

    #[test]
    fn only_well_formed_tokens_are_looked_up() {
        let token = new_token();
        assert_eq!(token.len(), 64);
        assert_eq!(token_from_file(&format!("{token}.ics")), Some(token.as_str()));
        assert_eq!(token_from_file(&token), Some(token.as_str()));
        assert_eq!(token_from_file("short.ics"), None);
        assert_eq!(token_from_file(&format!("{}.ics", "z".repeat(64))), None);
        assert_ne!(new_token(), token, "every token is new");
        assert_eq!(hash_token(&token).len(), 64);
        assert_ne!(hash_token(&token), token, "only the hash is stored");
    }
}
