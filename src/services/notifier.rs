//! E-mail notifications.
//!
//! Nothing is sent inline. An event writes rows to `notification_outbox` and a
//! worker (`spawn`) delivers them, retrying with a growing delay and giving up
//! after `MAX_ATTEMPTS`, so a mail problem never fails — or slows down — the
//! action that caused it. With no `smtp.host` there is no mailer and nothing is
//! queued at all.
//!
//! | event                | who is told                                        |
//! |----------------------|----------------------------------------------------|
//! | `roster_published`   | everyone with a shift in the month                 |
//! | `shift_changed`      | an employee whose published roster changed (one mail per sweep, not per day) |
//! | `swap_update`        | the people in a swap, as it moves                  |
//! | `leave_update`       | the requester, when their leave is decided         |
//! | `open_shift_offered` | employees who may take an open shift              |
//!
//! Employees may turn the whole channel or single events off
//! (`/notification-preferences`); everything is on until they do. Mails carry
//! the shift, the date and the status — never the reason behind a legal rule or
//! anything from an employee's protected-group data.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration as StdDuration;

use async_trait::async_trait;
use axum::{extract::State, Json};
use chrono::{Duration, NaiveDate, NaiveDateTime, Utc};
use lettre::message::{header::ContentType, Mailbox};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::SmtpConfig;
use crate::errors::AppError;
use crate::models::NewOutboxMessage;
use crate::repository::domain::{EmployeeRepository, NotificationRepository, ShiftRepository};
use crate::repository::AppState;
use crate::services::shift_swap::caller_employee;
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

pub const EVENT_ROSTER_PUBLISHED: &str = "roster_published";
pub const EVENT_SHIFT_CHANGED: &str = "shift_changed";
pub const EVENT_SWAP_UPDATE: &str = "swap_update";
pub const EVENT_LEAVE_UPDATE: &str = "leave_update";
pub const EVENT_OPEN_SHIFT_OFFERED: &str = "open_shift_offered";

pub const EVENTS: [&str; 5] = [
    EVENT_ROSTER_PUBLISHED,
    EVENT_SHIFT_CHANGED,
    EVENT_SWAP_UPDATE,
    EVENT_LEAVE_UPDATE,
    EVENT_OPEN_SHIFT_OFFERED,
];

/// A message is tried this often before it is marked `failed`.
pub const MAX_ATTEMPTS: i32 = 5;

/// How many messages one tick delivers.
const BATCH: i64 = 50;

/// How long a claimed message is held for the worker that took it.
const LEASE_MINUTES: i64 = 5;

/// Roster changes older than this are never announced — switching mail on
/// after a long time must not mail history.
const SWEEP_WINDOW_HOURS: i64 = 24;

/// How often the worker looks for something to send.
const TICK: StdDuration = StdDuration::from_secs(30);

/// Sends one plain-text message. Errors are the reason to record and retry.
#[async_trait]
pub trait Mailer: Send + Sync {
    async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), String>;
}

/// The SMTP implementation behind `smtp.*` in the configuration.
pub struct SmtpMailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl SmtpMailer {
    /// `None` while no host is configured; `Err` for a setting that cannot work.
    pub fn from_config(config: &SmtpConfig) -> Result<Option<Self>, String> {
        let host = config.host.trim();
        if host.is_empty() {
            return Ok(None);
        }
        let from: Mailbox = config
            .from
            .parse()
            .map_err(|e| format!("smtp.from {:?} is not an address: {e}", config.from))?;
        let builder = match config.tls.trim() {
            "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(host).map_err(|e| e.to_string())?,
            "none" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host),
            "starttls" | "" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host).map_err(|e| e.to_string())?,
            other => return Err(format!("smtp.tls must be starttls, tls or none, not {other:?}")),
        };
        let mut builder = builder.port(config.port);
        if !config.username.is_empty() {
            builder = builder.credentials(Credentials::new(config.username.clone(), config.password.clone()));
        }
        Ok(Some(Self { transport: builder.build(), from }))
    }
}

#[async_trait]
impl Mailer for SmtpMailer {
    async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), String> {
        let to: Mailbox = to.parse().map_err(|e| format!("{to:?} is not an address: {e}"))?;
        let message = Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())
            .map_err(|e| e.to_string())?;
        self.transport.send(message).await.map(|_| ()).map_err(|e| e.to_string())
    }
}

/// When a failed message is tried again: 2, 4, 8, 16 … minutes, at most an hour.
pub fn backoff(attempts: i32) -> Duration {
    Duration::minutes((1i64 << attempts.clamp(1, 6)).min(60))
}

/// Everyone `employees` names who wants `event` by e-mail, as `(id, address)`.
async fn recipients(state: &AppState, tenant_id: &str, event: &str, employees: &[Uuid]) -> Result<Vec<(Uuid, String)>, AppError> {
    let people = state.employee_repo.list_employees_by_ids(tenant_id, employees).await?;
    let prefs: HashMap<Uuid, _> = state
        .notification_repo
        .preferences_for(tenant_id, employees)
        .await?
        .into_iter()
        .map(|p| (p.employee_id, p))
        .collect();
    Ok(people
        .into_iter()
        .filter(|e| !e.email.trim().is_empty())
        .filter(|e| {
            prefs
                .get(&e.id)
                .is_none_or(|p| p.email_enabled && !p.muted_events.iter().any(|m| m == event))
        })
        .map(|e| (e.id, e.email))
        .collect())
}

fn with_footer(state: &AppState, message: &str, link_path: Option<&str>) -> String {
    let base = state.app_url.trim().trim_end_matches('/');
    let mut body = message.trim_end().to_string();
    if !base.is_empty() {
        if let Some(path) = link_path {
            body.push_str(&format!("\n\nOpen it: {base}/{}", path.trim_start_matches('/')));
        }
        body.push_str(&format!("\n\nYou can turn these e-mails off in your profile settings: {base}/notifications"));
    }
    body.push('\n');
    body
}

/// Queues `message` for each of `employees` who wants `event`. Best effort: a
/// problem is logged and swallowed, because the action that raised the event
/// has already happened. A no-op without a mailer.
pub async fn notify(
    state: &AppState,
    tenant_id: &str,
    event: &str,
    employees: &[Uuid],
    subject: &str,
    message: &str,
    link_path: Option<&str>,
) {
    if state.mailer.is_none() || employees.is_empty() {
        return;
    }
    let result = async {
        let who = recipients(state, tenant_id, event, employees).await?;
        let body = with_footer(state, message, link_path);
        let rows: Vec<NewOutboxMessage> = who
            .into_iter()
            .map(|(id, address)| NewOutboxMessage {
                tenant_id: tenant_id.to_string(),
                employee_id: Some(id),
                recipient: address,
                event: event.to_string(),
                subject: subject.to_string(),
                body: body.clone(),
            })
            .collect();
        state.notification_repo.enqueue(rows).await
    }
    .await;
    if let Err(e) = result {
        tracing::warn!("could not queue a {event} notification: {e}");
    }
}

// --- delivery ---------------------------------------------------------------

/// Sends what is due at `now`; returns how many messages it handled.
pub async fn deliver_due(state: &AppState, now: NaiveDateTime) -> usize {
    let Some(mailer) = state.mailer.clone() else { return 0 };
    let due = match state.notification_repo.claim_due(now, BATCH, Duration::minutes(LEASE_MINUTES)).await {
        Ok(due) => due,
        Err(e) => {
            tracing::warn!("could not read the notification outbox: {e}");
            return 0;
        }
    };
    let count = due.len();
    for message in due {
        let outcome = match mailer.send(&message.recipient, &message.subject, &message.body).await {
            Ok(()) => state.notification_repo.mark_sent(message.id, Utc::now().naive_utc()).await,
            Err(reason) => {
                let attempt = message.attempts + 1;
                let retry_at = (attempt < MAX_ATTEMPTS).then(|| now + backoff(attempt));
                tracing::warn!(
                    "mail {} to {} failed (attempt {attempt}/{MAX_ATTEMPTS}): {reason}",
                    message.id,
                    message.recipient
                );
                state.notification_repo.mark_attempt_failed(message.id, &reason, retry_at).await
            }
        };
        if let Err(e) = outcome {
            tracing::warn!("could not record the outcome of mail {}: {e}", message.id);
        }
    }
    count
}

/// One line for a roster entry as a notice stores it.
pub fn describe_entry(entry: &Option<Value>, shifts: &HashMap<String, String>) -> String {
    let Some(entry) = entry else { return "nothing".to_string() };
    if let Some(shift) = entry["shift_id"].as_str() {
        return shifts.get(shift).cloned().unwrap_or_else(|| "a shift".to_string());
    }
    match entry["absence_type"].as_str() {
        Some("free") | None => "day off".to_string(),
        Some("sick") => "sick".to_string(),
        Some("holiday") => "holiday".to_string(),
        Some("unavailable") => "absent".to_string(),
        Some(other) => other.replace('_', " "),
    }
}

/// The body of the "your shifts changed" mail.
pub fn digest_body(notices: &[crate::models::RosterChangeNotice], shifts: &HashMap<String, String>) -> String {
    let mut by_day: BTreeMap<NaiveDate, &crate::models::RosterChangeNotice> = BTreeMap::new();
    for notice in notices {
        by_day.insert(notice.date, notice);
    }
    let mut lines = vec!["Your published roster changed:".to_string(), String::new()];
    for (date, notice) in by_day {
        lines.push(format!(
            "  {date}: {} -> {}",
            describe_entry(&notice.before, shifts),
            describe_entry(&notice.after, shifts)
        ));
    }
    lines.join("\n")
}

/// Turns roster change notices nobody has been mailed about into one mail per employee.
pub async fn announce_roster_changes(state: &AppState, now: NaiveDateTime) {
    if state.mailer.is_none() {
        return;
    }
    let since = now - Duration::hours(SWEEP_WINDOW_HOURS);
    let digests = match state.notification_repo.sweep_roster_notices(since, 500).await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("could not sweep roster change notices: {e}");
            return;
        }
    };
    let mut shift_names: HashMap<String, HashMap<String, String>> = HashMap::new();
    for digest in digests {
        if !shift_names.contains_key(&digest.tenant_id) {
            let names = state
                .shift_repo
                .list_shifts(&digest.tenant_id)
                .await
                .map(|shifts| shifts.into_iter().map(|s| (s.id.to_string(), s.name)).collect())
                .unwrap_or_default();
            shift_names.insert(digest.tenant_id.clone(), names);
        }
        let names = &shift_names[&digest.tenant_id];
        let count = digest.notices.len();
        let subject = if count == 1 { "Your roster changed (1 day)".to_string() } else { format!("Your roster changed ({count} days)") };
        notify(
            state,
            &digest.tenant_id,
            EVENT_SHIFT_CHANGED,
            &[digest.employee_id],
            &subject,
            &digest_body(&digest.notices, names),
            Some("changes"),
        )
        .await;
    }
}

/// Starts the worker: every `TICK` it mails new roster changes and delivers what
/// is due. Does nothing without a mailer.
pub fn spawn(state: AppState) {
    if state.mailer.is_none() {
        return;
    }
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(TICK);
        loop {
            interval.tick().await;
            let now = Utc::now().naive_utc();
            announce_roster_changes(&state, now).await;
            deliver_due(&state, now).await;
        }
    });
}

// --- preferences API ----------------------------------------------------------

#[derive(Deserialize)]
pub struct UpdatePreferences {
    pub email_enabled: bool,
    #[serde(default)]
    pub muted_events: Vec<String>,
}

pub struct NotificationService;

fn preferences_body(employee_id: Option<Uuid>, enabled: bool, muted: Vec<String>, configured: bool) -> Value {
    json!({
        "employee_id": employee_id,
        "email_enabled": enabled,
        "muted_events": muted,
        "events": EVENTS,
        "email_configured": configured,
    })
}

impl NotificationService {
    /// GET /notification-preferences — the caller's own; everything on until changed.
    pub async fn get_preferences(
        tenant: TenantContext,
        user: UserContext,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let configured = state.mailer.is_some();
        let Some(me) = caller_employee(&state, &tenant, &user).await? else {
            return Ok(Json(preferences_body(None, true, vec![], configured)));
        };
        let body = match state.notification_repo.get_preference(&tenant.0, me.id).await? {
            Some(p) => preferences_body(Some(me.id), p.email_enabled, p.muted_events, configured),
            None => preferences_body(Some(me.id), true, vec![], configured),
        };
        Ok(Json(body))
    }

    /// PUT /notification-preferences — `{email_enabled, muted_events}`.
    pub async fn update_preferences(
        tenant: TenantContext,
        user: UserContext,
        State(state): State<AppState>,
        Json(body): Json<UpdatePreferences>,
    ) -> Result<Json<Value>, AppError> {
        let me = caller_employee(&state, &tenant, &user)
            .await?
            .ok_or_else(|| AppError::Validation("No employee matches your account, so there is nothing to set".into()))?;
        if let Some(unknown) = body.muted_events.iter().find(|e| !EVENTS.contains(&e.as_str())) {
            return Err(AppError::Validation(format!("Unknown event {unknown:?}")));
        }
        let mut muted = body.muted_events;
        muted.sort();
        muted.dedup();
        let saved = state
            .notification_repo
            .save_preference(&tenant.0, me.id, body.email_enabled, muted)
            .await?;
        Ok(Json(preferences_body(Some(me.id), saved.email_enabled, saved.muted_events, state.mailer.is_some())))
    }

    /// GET /notification-outbox — the tenant's recent mails and how they went.
    /// Planners and admins only: it shows other people's addresses.
    pub async fn outbox(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        if !roles.can_write() {
            return Err(AppError::Forbidden("Only a planner or an admin may read the notification outbox".into()));
        }
        let rows = state.notification_repo.list_outbox(&tenant.0, 100).await?;
        Ok(Json(serde_json::to_value(rows).unwrap()))
    }
}

/// A mailer that records instead of sending — for tests.
#[derive(Default)]
pub struct RecordingMailer {
    pub sent: std::sync::Mutex<Vec<(String, String, String)>>,
    /// Fails every send with this reason while set.
    pub fail_with: std::sync::Mutex<Option<String>>,
}

#[async_trait]
impl Mailer for RecordingMailer {
    async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), String> {
        if let Some(reason) = self.fail_with.lock().unwrap().clone() {
            return Err(reason);
        }
        self.sent.lock().unwrap().push((to.to_string(), subject.to_string(), body.to_string()));
        Ok(())
    }
}

/// Convenience for tests and callers holding an `Arc<RecordingMailer>`.
pub fn as_mailer(mailer: &Arc<RecordingMailer>) -> Arc<dyn Mailer> {
    mailer.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_back_off_and_stop_growing() {
        assert_eq!(backoff(1), Duration::minutes(2));
        assert_eq!(backoff(2), Duration::minutes(4));
        assert_eq!(backoff(4), Duration::minutes(16));
        assert_eq!(backoff(9), Duration::minutes(60));
    }

    #[test]
    fn entries_read_as_words() {
        let shift = Uuid::new_v4().to_string();
        let names = HashMap::from([(shift.clone(), "Early".to_string())]);
        assert_eq!(describe_entry(&Some(json!({ "shift_id": shift })), &names), "Early");
        assert_eq!(describe_entry(&Some(json!({ "absence_type": "free" })), &names), "day off");
        assert_eq!(describe_entry(&Some(json!({ "absence_type": "sick" })), &names), "sick");
        assert_eq!(describe_entry(&None, &names), "nothing");
    }

    #[test]
    fn an_unconfigured_host_means_no_mailer() {
        let config = SmtpConfig::default();
        assert!(SmtpMailer::from_config(&config).unwrap().is_none());
    }

    #[test]
    fn a_bad_sender_or_tls_mode_is_refused_up_front() {
        let mut config = SmtpConfig { host: "smtp.example.org".into(), ..SmtpConfig::default() };
        config.from = "not an address".into();
        assert!(SmtpMailer::from_config(&config).is_err());
        config.from = "Shift <shift@example.org>".into();
        config.tls = "carrier-pigeon".into();
        assert!(SmtpMailer::from_config(&config).is_err());
    }
}
