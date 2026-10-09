//! Whether a write to the confirmed roster is allowed, given the status of the
//! months it touches — the one place every roster writer asks.
//!
//! - draft: planners and admins write freely, nothing is tracked
//! - published: every change becomes a notice for the employee it affects; a
//!   change to a day inside the freeze window (today … today + freeze_days − 1)
//!   needs a reason
//! - locked: only `shift-admin`, and only with a reason
//!
//! The reason travels as the `X-Change-Reason` header (URL-encoded), the source
//! of a change as `X-Change-Source` (only `replacement` is honoured; every
//! endpoint knows its own source otherwise). A missing reason is answered with
//! 428 `reason_required`, so a client can ask for one and retry the request.
//!
//! The decision is taken inside the writing transaction, against month rows
//! read `FOR SHARE` (see `repository::rostertracking`), so a month cannot be
//! locked between the check and the write.

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};
use chrono::{Duration, Local, NaiveDate};

use crate::errors::AppError;
use crate::repository::domain::{month_start, ChangeSource, MonthStatus, PlannerSettingsRepository};
use crate::repository::AppState;
use crate::services::audit_log::AuditActor;
use crate::services::tenant::{RoleContext, UserContext};

pub const REASON_HEADER: &str = "x-change-reason";
pub const SOURCE_HEADER: &str = "x-change-source";

/// Today, for the roster: the server's local date, as shift swaps use it.
pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// What a write to the roster does about notices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteMode {
    /// Only draft months: written as before, no notices.
    Silent,
    /// A published or locked month: every changed employee-day gets a notice.
    Tracked,
}

/// Who is writing, why, and against which settings. Every repository method
/// that writes the confirmed roster takes one.
#[derive(Debug, Clone)]
pub struct RosterChangeCtx {
    pub is_admin: bool,
    pub actor: Option<String>,
    pub reason: Option<String>,
    pub source: ChangeSource,
    pub today: NaiveDate,
    pub freeze_days: i64,
}

impl RosterChangeCtx {
    /// Whether a write touching `dates`, whose months have the given effective
    /// statuses, may go ahead — and whether it is tracked.
    pub fn decide(&self, statuses: &[(NaiveDate, MonthStatus)], dates: &[NaiveDate]) -> Result<WriteMode, AppError> {
        decide(statuses, dates, self)
    }
}

fn status_of(statuses: &[(NaiveDate, MonthStatus)], date: NaiveDate) -> MonthStatus {
    let month = month_start(date);
    statuses
        .iter()
        .find(|(m, _)| *m == month)
        .map(|(_, s)| *s)
        .unwrap_or(MonthStatus::Draft)
}

fn month_name(date: NaiveDate) -> String {
    date.format("%B %Y").to_string()
}

/// The rules of the module comment. `statuses` holds the effective status of
/// each month start (missing = draft); `dates` are the days the write touches.
pub fn decide(statuses: &[(NaiveDate, MonthStatus)], dates: &[NaiveDate], ctx: &RosterChangeCtx) -> Result<WriteMode, AppError> {
    let has_reason = ctx.reason.as_deref().is_some_and(|r| !r.trim().is_empty());
    let mut mode = WriteMode::Silent;

    if let Some(locked) = dates.iter().find(|d| status_of(statuses, **d) == MonthStatus::Locked) {
        if !ctx.is_admin {
            return Err(AppError::Forbidden(format!(
                "{} is locked: only an admin may change it",
                month_name(*locked)
            )));
        }
        if !has_reason {
            return Err(AppError::ReasonRequired(format!(
                "{} is locked: give a reason for changing it",
                month_name(*locked)
            )));
        }
        mode = WriteMode::Tracked;
    }

    let freeze_end = ctx.today + Duration::days(ctx.freeze_days);
    for date in dates {
        if status_of(statuses, *date) != MonthStatus::Published {
            continue;
        }
        mode = WriteMode::Tracked;
        if !has_reason && *date >= ctx.today && *date < freeze_end {
            return Err(AppError::ReasonRequired(format!(
                "{date} is within the next {} days of the published roster: give a reason for changing it",
                ctx.freeze_days
            )));
        }
    }
    Ok(mode)
}

/// The caller's part of a roster change, read from the request: roles, actor,
/// and the `X-Change-Reason` / `X-Change-Source` headers.
#[derive(Debug, Clone)]
pub struct RosterChange {
    pub is_admin: bool,
    pub actor: Option<String>,
    pub reason: Option<String>,
    /// `Some(Replacement)` when the client says so; otherwise the endpoint decides.
    pub source: Option<ChangeSource>,
}

impl RosterChange {
    /// The full context, with the tenant's freeze window and today's date.
    /// `source` is what the endpoint does, unless the client named a replacement.
    pub async fn ctx(&self, state: &AppState, tenant_id: &str, source: ChangeSource) -> Result<RosterChangeCtx, AppError> {
        let settings = state.planner_settings_repo.get_or_create_planner_settings(tenant_id).await?;
        Ok(RosterChangeCtx {
            is_admin: self.is_admin,
            actor: self.actor.clone(),
            reason: self.reason.clone(),
            source: self.source.unwrap_or(source),
            today: today(),
            freeze_days: settings.freeze_days as i64,
        })
    }
}

#[async_trait]
impl FromRequestParts<AppState> for RosterChange {
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let roles = RoleContext::from_request_parts(parts, state).await?;
        let actor = AuditActor::from_request_parts(parts, state).await.map_err(|_| StatusCode::UNAUTHORIZED)?;
        // The gateway's x-userinfo name, else the token's — as shift swaps name their actor.
        let user = UserContext::from_request_parts(parts, state).await.unwrap_or_default();
        let actor = actor.0.or(user.username).or(user.email).or(user.subject);
        let header = |name: &str| {
            parts
                .headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(percent_decode)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let source = header(SOURCE_HEADER)
            .filter(|s| s == "replacement")
            .map(|_| ChangeSource::Replacement);
        Ok(Self {
            is_admin: roles.is_admin(),
            actor,
            reason: header(REASON_HEADER),
            source,
        })
    }
}

/// Decodes `%XX` escapes (UTF-8) so a reason can carry any text in a header.
/// Anything malformed is kept as it is.
pub fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16).map(|v| v as u8);
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    const TODAY: (i32, u32, u32) = (2026, 10, 9);

    fn ctx(is_admin: bool, reason: Option<&str>) -> RosterChangeCtx {
        RosterChangeCtx {
            is_admin,
            actor: Some("someone".into()),
            reason: reason.map(String::from),
            source: ChangeSource::Manual,
            today: d(TODAY.0, TODAY.1, TODAY.2),
            freeze_days: 7,
        }
    }

    fn statuses() -> Vec<(NaiveDate, MonthStatus)> {
        vec![
            (d(2026, 9, 1), MonthStatus::Locked),
            (d(2026, 10, 1), MonthStatus::Published),
            // November: no row — draft
        ]
    }

    #[test]
    fn a_draft_month_is_written_silently_by_a_planner() {
        let mode = decide(&statuses(), &[d(2026, 11, 3)], &ctx(false, None)).unwrap();
        assert_eq!(mode, WriteMode::Silent);
    }

    #[test]
    fn a_draft_day_inside_the_freeze_window_needs_no_reason() {
        let draft = vec![(d(2026, 10, 1), MonthStatus::Draft)];
        assert_eq!(decide(&draft, &[d(2026, 10, 10)], &ctx(false, None)).unwrap(), WriteMode::Silent);
    }

    #[test]
    fn a_published_day_beyond_the_freeze_window_is_tracked_without_a_reason() {
        let mode = decide(&statuses(), &[d(2026, 10, 20)], &ctx(false, None)).unwrap();
        assert_eq!(mode, WriteMode::Tracked);
    }

    #[test]
    fn a_published_day_inside_the_freeze_window_needs_a_reason() {
        let tomorrow = d(2026, 10, 10);
        assert!(matches!(decide(&statuses(), &[tomorrow], &ctx(false, None)), Err(AppError::ReasonRequired(_))));
        assert!(matches!(decide(&statuses(), &[tomorrow], &ctx(false, Some("  "))), Err(AppError::ReasonRequired(_))), "blank is no reason");
        assert_eq!(decide(&statuses(), &[tomorrow], &ctx(false, Some("sick call"))).unwrap(), WriteMode::Tracked);
    }

    #[test]
    fn the_freeze_window_spans_today_to_today_plus_freeze_days_minus_one() {
        assert!(decide(&statuses(), &[d(2026, 10, 9)], &ctx(false, None)).is_err(), "today");
        assert!(decide(&statuses(), &[d(2026, 10, 15)], &ctx(false, None)).is_err(), "today + 6");
        assert!(decide(&statuses(), &[d(2026, 10, 16)], &ctx(false, None)).is_ok(), "today + 7");
        assert!(decide(&statuses(), &[d(2026, 10, 8)], &ctx(false, None)).is_ok(), "yesterday: not ahead, not frozen");
    }

    #[test]
    fn a_freeze_window_of_zero_is_off() {
        let mut c = ctx(false, None);
        c.freeze_days = 0;
        assert_eq!(decide(&statuses(), &[d(2026, 10, 9)], &c).unwrap(), WriteMode::Tracked);
    }

    #[test]
    fn a_planner_may_not_change_a_locked_month() {
        let refused = decide(&statuses(), &[d(2026, 9, 30)], &ctx(false, Some("reason")));
        assert!(matches!(refused, Err(AppError::Forbidden(_))));
    }

    #[test]
    fn an_admin_changes_a_locked_month_only_with_a_reason() {
        assert!(matches!(decide(&statuses(), &[d(2026, 9, 30)], &ctx(true, None)), Err(AppError::ReasonRequired(_))));
        assert_eq!(decide(&statuses(), &[d(2026, 9, 30)], &ctx(true, Some("correction"))).unwrap(), WriteMode::Tracked);
    }

    #[test]
    fn a_write_spanning_a_locked_month_is_refused_completely_for_a_planner() {
        let refused = decide(&statuses(), &[d(2026, 10, 20), d(2026, 9, 30)], &ctx(false, Some("reason")));
        assert!(matches!(refused, Err(AppError::Forbidden(_))));
    }

    #[test]
    fn reasons_are_url_decoded() {
        assert_eq!(percent_decode("Krankmeldung%20M%C3%BCller"), "Krankmeldung Müller");
        assert_eq!(percent_decode("100%"), "100%", "a lone percent is kept");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("%é1"), "%é1", "non-ASCII after a percent is kept, not split");
    }
}
