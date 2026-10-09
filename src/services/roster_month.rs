//! `/roster-months` — the status of each month of the confirmed roster
//! (draft → published → locked), its publish deadline, and the transitions:
//! planners publish; admins unpublish, unlock and lock, the first two with a
//! reason. See `roster_guard` for what each status allows.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::errors::AppError;
use crate::repository::domain::{
    effective_status, month_end, month_start, months_between, MonthStatus, PlannerSettingsRepository, RosterMonth,
    RosterMonthRepository, RosterMonthTransition,
};
use crate::repository::AppState;
use crate::services::audit_log;
use crate::services::roster_guard::{today, RosterChange};
use crate::services::tenant::TenantContext;

#[derive(Deserialize)]
pub struct RosterMonthsQuery {
    /// `YYYY-MM`; defaults to the current month.
    pub from: Option<String>,
    /// `YYYY-MM`; defaults to two months after `from`.
    pub to: Option<String>,
}

/// Where a draft month stands against its publish deadline.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Deadline {
    /// Less than `publish_lead_days` days before it starts.
    Due,
    /// Started (and not yet over) without being published.
    Overdue,
}

#[derive(Serialize, Debug)]
pub struct RosterMonthResponse {
    /// `YYYY-MM`.
    pub month: String,
    pub status: MonthStatus,
    pub published_at: Option<NaiveDateTime>,
    pub published_by: Option<String>,
    pub locked_at: Option<NaiveDateTime>,
    pub locked_by: Option<String>,
    pub reopened: bool,
    /// The day by which it is due to be published.
    pub publish_by: NaiveDate,
    /// Only for draft months that are due or overdue.
    pub deadline: Option<Deadline>,
}

fn parse_month(value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::Validation(format!("Invalid month '{value}', use YYYY-MM")))
}

fn format_month(month: NaiveDate) -> String {
    format!("{:04}-{:02}", month.year(), month.month())
}

/// The deadline state of `month` on `today`; `None` unless it is a draft that is due or overdue.
pub fn deadline(status: MonthStatus, month: NaiveDate, today: NaiveDate, lead_days: i64) -> Option<Deadline> {
    if status != MonthStatus::Draft || month_end(month) < today {
        return None;
    }
    if today >= month {
        Some(Deadline::Overdue)
    } else if today >= month - Duration::days(lead_days) {
        Some(Deadline::Due)
    } else {
        None
    }
}

fn response(month: NaiveDate, row: Option<&RosterMonth>, today: NaiveDate, lead_days: i64) -> RosterMonthResponse {
    let status = effective_status(row, month, today);
    RosterMonthResponse {
        month: format_month(month),
        status,
        published_at: row.and_then(|r| r.published_at),
        published_by: row.and_then(|r| r.published_by.clone()),
        locked_at: row.and_then(|r| r.locked_at),
        locked_by: row.and_then(|r| r.locked_by.clone()),
        reopened: row.is_some_and(|r| r.reopened),
        publish_by: month - Duration::days(lead_days),
        deadline: deadline(status, month, today, lead_days),
    }
}

async fn lead_days(state: &AppState, tenant_id: &str) -> Result<i64, AppError> {
    Ok(state.planner_settings_repo.get_or_create_planner_settings(tenant_id).await?.publish_lead_days as i64)
}

pub struct RosterMonthService;

impl RosterMonthService {
    /// GET /roster-months?from=YYYY-MM&to=YYYY-MM — every month in the range,
    /// with its effective status and deadline (at most 36 months).
    pub async fn list_roster_months(
        tenant: TenantContext,
        Query(q): Query<RosterMonthsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<RosterMonthResponse>>, AppError> {
        let today = today();
        let from = q.from.as_deref().map(parse_month).transpose()?.unwrap_or_else(|| month_start(today));
        let to = match q.to.as_deref() {
            Some(to) => parse_month(to)?,
            None => month_start(month_end(month_end(from) + Duration::days(1)) + Duration::days(1)),
        };
        if to < from {
            return Err(AppError::Validation("'to' must not be before 'from'".into()));
        }
        let months = months_between(from, to);
        if months.len() > 36 {
            return Err(AppError::Validation("At most 36 months at a time".into()));
        }

        let rows = state.roster_month_repo.list_roster_months(&tenant.0, from, to).await?;
        let lead = lead_days(&state, &tenant.0).await?;
        Ok(Json(
            months
                .into_iter()
                .map(|m| response(m, rows.iter().find(|r| r.month == m), today, lead))
                .collect(),
        ))
    }

    /// POST /roster-months/:month/publish — a draft month becomes visible to everyone.
    pub async fn publish(
        tenant: TenantContext,
        change: RosterChange,
        Path(month): Path<String>,
        State(state): State<AppState>,
    ) -> Result<Json<RosterMonthResponse>, AppError> {
        transition(&state, &tenant, &change, &month, Action::Publish).await
    }

    /// POST /roster-months/:month/unpublish — admin, with a reason: back to draft.
    pub async fn unpublish(
        tenant: TenantContext,
        change: RosterChange,
        Path(month): Path<String>,
        State(state): State<AppState>,
    ) -> Result<Json<RosterMonthResponse>, AppError> {
        transition(&state, &tenant, &change, &month, Action::Unpublish).await
    }

    /// POST /roster-months/:month/unlock — admin, with a reason: a locked month
    /// is published again and stays so until an admin locks it.
    pub async fn unlock(
        tenant: TenantContext,
        change: RosterChange,
        Path(month): Path<String>,
        State(state): State<AppState>,
    ) -> Result<Json<RosterMonthResponse>, AppError> {
        transition(&state, &tenant, &change, &month, Action::Unlock).await
    }

    /// POST /roster-months/:month/lock — admin: a published month that has ended is locked.
    pub async fn lock(
        tenant: TenantContext,
        change: RosterChange,
        Path(month): Path<String>,
        State(state): State<AppState>,
    ) -> Result<Json<RosterMonthResponse>, AppError> {
        transition(&state, &tenant, &change, &month, Action::Lock).await
    }
}

#[derive(Clone, Copy)]
enum Action {
    Publish,
    Unpublish,
    Unlock,
    Lock,
}

impl Action {
    fn name(self) -> &'static str {
        match self {
            Action::Publish => "publish",
            Action::Unpublish => "unpublish",
            Action::Unlock => "unlock",
            Action::Lock => "lock",
        }
    }

    fn past(self) -> &'static str {
        match self {
            Action::Publish => "published",
            Action::Unpublish => "unpublished",
            Action::Unlock => "unlocked",
            Action::Lock => "locked",
        }
    }
}

async fn transition(
    state: &AppState,
    tenant: &TenantContext,
    change: &RosterChange,
    month: &str,
    action: Action,
) -> Result<Json<RosterMonthResponse>, AppError> {
    let month = parse_month(month)?;
    let today = today();
    let admin_only = !matches!(action, Action::Publish);
    if admin_only && !change.is_admin {
        return Err(AppError::Forbidden(format!("Only an admin may {} a month", action.name())));
    }
    let needs_reason = matches!(action, Action::Unpublish | Action::Unlock);
    if needs_reason && change.reason.is_none() {
        return Err(AppError::ReasonRequired(format!("Give a reason to {} {}", action.name(), format_month(month))));
    }
    if matches!(action, Action::Lock) && month_end(month) >= today {
        return Err(AppError::Conflict(format!("{} has not ended yet", format_month(month))));
    }

    let (from, to, reopened) = match action {
        Action::Publish => (MonthStatus::Draft, MonthStatus::Published, false),
        Action::Unpublish => (MonthStatus::Published, MonthStatus::Draft, false),
        Action::Unlock => (MonthStatus::Locked, MonthStatus::Published, true),
        Action::Lock => (MonthStatus::Published, MonthStatus::Locked, false),
    };
    let transition = RosterMonthTransition { month, from: vec![from], to, actor: change.actor.clone(), reopened };
    let Some(saved) = state.roster_month_repo.transition_roster_month(&tenant.0, transition, today).await? else {
        let rows = state.roster_month_repo.list_roster_months(&tenant.0, month, month).await?;
        let current = effective_status(rows.first(), month, today);
        return Err(AppError::Conflict(format!(
            "{} is {}, so it cannot be {}",
            format_month(month),
            current.as_str(),
            action.past()
        )));
    };

    let changes = json!({ "status": saved.status, "reason": change.reason }).to_string();
    audit_log::record(
        state,
        &tenant.0,
        change.actor.clone(),
        &format!("roster_month.{}", action.name()),
        "roster_month",
        Some(format_month(month)),
        Some(changes),
    )
    .await;

    let lead = lead_days(state, &tenant.0).await?;
    Ok(Json(response(month, Some(&saved), today, lead)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn a_draft_month_is_due_within_the_lead_days_and_overdue_once_it_starts() {
        let nov = d(2026, 11, 1);
        assert_eq!(deadline(MonthStatus::Draft, nov, d(2026, 10, 3), 28), None, "29 days ahead");
        assert_eq!(deadline(MonthStatus::Draft, nov, d(2026, 10, 4), 28), Some(Deadline::Due), "28 days ahead");
        assert_eq!(deadline(MonthStatus::Draft, nov, d(2026, 11, 1), 28), Some(Deadline::Overdue));
        assert_eq!(deadline(MonthStatus::Draft, nov, d(2026, 12, 1), 28), None, "over: nobody publishes the past");
    }

    #[test]
    fn a_published_month_has_no_deadline() {
        assert_eq!(deadline(MonthStatus::Published, d(2026, 11, 1), d(2026, 10, 20), 28), None);
    }
}
