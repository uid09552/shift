//! Leave (vacation) requests: an employee asks for a date range off, a
//! `shift-planner` or `shift-admin` approves or rejects it.
//!
//! The path is self-service (`SELF_SERVICE_SEGMENTS`), so every mutation reaches
//! these handlers whatever the caller's role; each one checks who may take it:
//!
//! | action             | who                                              |
//! |--------------------|--------------------------------------------------|
//! | create             | the employee themselves, never a planner/admin   |
//! | cancel             | the requester, while the request is pending      |
//! | approve / reject   | `shift-planner` / `shift-admin`                  |
//! | revoke             | `shift-planner` / `shift-admin`, an approved one |
//! | blackouts, limits  | `shift-planner` / `shift-admin`                  |
//!
//! Approving writes the days as absences (see `LeaveRepository::approve_leave`)
//! under the roster guard like any other roster write — a reason inside the
//! freeze window of a published month, an admin for a locked one, a change
//! notice for the employee. Pending leave is a soft "would rather be off" for the
//! optimizer (`OptimizerService::build_task_dto`); approved leave is a hard
//! absence.
//!
//! A **blackout** period refuses a request outright. A **limit** (at most N
//! people with a capability absent on one day) never does: it is reported as a
//! warning to the employee asking and to whoever decides, who may still approve.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{LeaveBlackout, LeaveLimit, LeaveRequest, NewLeaveBlackout, NewLeaveRequest};
use crate::repository::domain::{
    leave_status, CapabilityRepository, ChangeSource, EmployeeRepository, LeaveFilter, LeaveRepository,
};
use crate::repository::leaverepository::days_of;
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::notifier;
use crate::services::roster_guard::RosterChange;
use crate::services::shift_swap::{actor_name, caller_employee, ensure_is, ensure_planner, today};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

/// The longest range one request may cover.
pub const MAX_LEAVE_DAYS: i64 = 366;

const MAX_NOTE_CHARS: usize = 500;

#[derive(Deserialize)]
pub struct ListLeaveQuery {
    /// Comma-separated statuses.
    pub status: Option<String>,
    /// Planners only: this employee's requests.
    pub employee_id: Option<Uuid>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub struct CreateLeave {
    pub employee_id: Uuid,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub note: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct Decision {
    pub comment: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateBlackout {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateLimits {
    pub limits: Vec<LeaveLimit>,
}

/// The first blackout that overlaps `start`…`end`.
pub fn blackout_conflict(blackouts: &[LeaveBlackout], start: NaiveDate, end: NaiveDate) -> Option<&LeaveBlackout> {
    blackouts.iter().find(|b| b.start_date <= end && b.end_date >= start)
}

/// The days in `start`…`end` on which one more absent person would exceed
/// `max_absent`, given how many of their peers are already absent each day.
pub fn days_over_limit(
    start: NaiveDate,
    end: NaiveDate,
    max_absent: i32,
    peers_absent: &HashMap<NaiveDate, i64>,
) -> Vec<NaiveDate> {
    days_of(start, end)
        .into_iter()
        .filter(|day| peers_absent.get(day).copied().unwrap_or(0) + 1 > i64::from(max_absent))
        .collect()
}

/// How the limits look for this request: one entry per capability breached.
async fn limit_warnings(state: &AppState, tenant: &TenantContext, leave: &LeaveRequest) -> Result<Vec<Value>, AppError> {
    let limits = state.leave_repo.list_limits(&tenant.0).await?;
    if limits.is_empty() {
        return Ok(Vec::new());
    }
    let people = state.employee_repo.list_employees(&tenant.0, None, None).await?;
    let names: HashMap<Uuid, String> = state
        .capability_repo
        .list_capabilities(&tenant.0)
        .await?
        .into_iter()
        .map(|c| (c.id, c.name))
        .collect();
    let Some(me) = people.iter().find(|e| e.id == leave.employee_id) else { return Ok(Vec::new()) };

    let mut warnings = Vec::new();
    for limit in limits {
        if !me.capabilities.iter().any(|c| c.id == limit.capability_id) {
            continue;
        }
        let peers: Vec<Uuid> = people
            .iter()
            .filter(|e| e.id != me.id && e.capabilities.iter().any(|c| c.id == limit.capability_id))
            .map(|e| e.id)
            .collect();
        let mut per_day: HashMap<NaiveDate, i64> = HashMap::new();
        for (_, day) in state.leave_repo.absences_in_range(&tenant.0, &peers, leave.start_date, leave.end_date).await? {
            *per_day.entry(day).or_default() += 1;
        }
        let dates = days_over_limit(leave.start_date, leave.end_date, limit.max_absent, &per_day);
        if !dates.is_empty() {
            warnings.push(json!({
                "kind": "limit",
                "capability_id": limit.capability_id,
                "capability": names.get(&limit.capability_id),
                "max_absent": limit.max_absent,
                "dates": dates,
            }));
        }
    }
    Ok(warnings)
}

async fn detail(state: &AppState, tenant: &TenantContext, leave: &LeaveRequest, with_warnings: bool) -> Result<Value, AppError> {
    let mut body = serde_json::to_value(leave).unwrap();
    if with_warnings && leave.status == leave_status::PENDING {
        body["warnings"] = Value::Array(limit_warnings(state, tenant, leave).await?);
    }
    Ok(body)
}

async fn load(state: &AppState, tenant: &TenantContext, id: Uuid) -> Result<LeaveRequest, AppError> {
    state.leave_repo.get_leave(&tenant.0, id).await?.ok_or(AppError::NotFound)
}

fn audit_changes(leave: &LeaveRequest, comment: &Option<String>) -> Option<String> {
    Some(
        json!({
            "status": leave.status,
            "employee_id": leave.employee_id,
            "start_date": leave.start_date,
            "end_date": leave.end_date,
            "comment": comment,
        })
        .to_string(),
    )
}

async fn record(state: &AppState, tenant: &TenantContext, actor: Option<String>, action: &str, leave: &LeaveRequest, comment: &Option<String>) {
    audit_log::record(state, &tenant.0, actor, action, "leave_request", Some(leave.id.to_string()), audit_changes(leave, comment)).await;
}

fn range_text(leave: &LeaveRequest) -> String {
    if leave.start_date == leave.end_date {
        leave.start_date.to_string()
    } else {
        format!("{} to {}", leave.start_date, leave.end_date)
    }
}

/// Tells the employee how their request was decided.
async fn tell_requester(state: &AppState, tenant: &TenantContext, leave: &LeaveRequest, verb: &str, comment: &Option<String>) {
    let mut message = format!("Your leave request for {} was {verb}.", range_text(leave));
    if let Some(comment) = comment.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        message.push_str(&format!("\n\nComment: {comment}"));
    }
    notifier::notify(
        state,
        &tenant.0,
        notifier::EVENT_LEAVE_UPDATE,
        &[leave.employee_id],
        &format!("Leave {verb}: {}", range_text(leave)),
        &message,
        Some("leave"),
    )
    .await;
}

fn clean_comment(body: Option<Json<Decision>>) -> Option<String> {
    body.and_then(|Json(d)| d.comment)
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
}

pub struct LeaveService;

impl LeaveService {
    /// GET /leave-requests — planners see the tenant's, everyone else their own.
    pub async fn list_leave_requests(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        Query(q): Query<ListLeaveQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let employee_id = if roles.can_write() {
            q.employee_id
        } else {
            match caller_employee(&state, &tenant, &user).await? {
                Some(me) => Some(me.id),
                None => return Ok(Json(json!([]))),
            }
        };
        let statuses = q
            .status
            .map(|s| s.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect())
            .unwrap_or_default();
        let rows = state
            .leave_repo
            .list_leave(&tenant.0, LeaveFilter { employee_id, statuses, from: q.from, to: q.to })
            .await?;
        Ok(Json(serde_json::to_value(rows).unwrap()))
    }

    /// GET /leave-requests/pending-count — how many await a decision. Planners only.
    pub async fn pending_count(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let count = state.leave_repo.count_leave_with_status(&tenant.0, leave_status::PENDING).await?;
        Ok(Json(json!({ "count": count })))
    }

    /// GET /leave-requests/:id — with `warnings` (limit breaches) while pending.
    pub async fn get_leave_request(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let leave = load(&state, &tenant, id).await?;
        if !roles.can_write() {
            let me = caller_employee(&state, &tenant, &user).await?;
            if me.is_none_or(|me| me.id != leave.employee_id) {
                return Err(AppError::NotFound);
            }
        }
        Ok(Json(detail(&state, &tenant, &leave, true).await?))
    }

    /// POST /leave-requests — `{employee_id, start_date, end_date, note?}`.
    pub async fn create_leave_request(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<CreateLeave>,
    ) -> Result<Json<Value>, AppError> {
        // A planner's request would need nobody's consent but their own.
        if roles.can_write() {
            return Err(AppError::Forbidden("Planners and admins decide on leave; only employees request it".into()));
        }
        let requester = ensure_is(&state, &tenant, &user, body.employee_id, "You may only request leave for yourself").await?;
        if body.end_date < body.start_date {
            return Err(AppError::Validation("The end date is before the start date".into()));
        }
        if body.start_date < today() {
            return Err(AppError::Validation(format!("{} has passed", body.start_date)));
        }
        if (body.end_date - body.start_date).num_days() + 1 > MAX_LEAVE_DAYS {
            return Err(AppError::Validation(format!("A request may cover at most {MAX_LEAVE_DAYS} days")));
        }
        let note = body.note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if note.as_ref().is_some_and(|n| n.chars().count() > MAX_NOTE_CHARS) {
            return Err(AppError::Validation(format!("The note may be at most {MAX_NOTE_CHARS} characters")));
        }

        let blackouts = state.leave_repo.list_blackouts(&tenant.0).await?;
        if let Some(b) = blackout_conflict(&blackouts, body.start_date, body.end_date) {
            let why = b.reason.as_deref().map(|r| format!(" ({r})")).unwrap_or_default();
            return Err(AppError::Validation(format!(
                "No leave can be requested from {} to {}{why}",
                b.start_date, b.end_date
            )));
        }

        let overlapping = state
            .leave_repo
            .list_leave(
                &tenant.0,
                LeaveFilter {
                    employee_id: Some(requester.id),
                    statuses: vec![leave_status::PENDING.into(), leave_status::APPROVED.into()],
                    from: Some(body.start_date),
                    to: Some(body.end_date),
                },
            )
            .await?;
        if let Some(other) = overlapping.first() {
            return Err(AppError::Conflict(format!("You already have leave from {} to {}", other.start_date, other.end_date)));
        }

        let leave = state
            .leave_repo
            .create_leave(
                &tenant.0,
                NewLeaveRequest {
                    tenant_id: tenant.0.clone(),
                    employee_id: requester.id,
                    start_date: body.start_date,
                    end_date: body.end_date,
                    note,
                },
            )
            .await?;
        record(&state, &tenant, actor_name(&actor, &user), "leave_request.create", &leave, &None).await;
        Ok(Json(detail(&state, &tenant, &leave, true).await?))
    }

    /// POST /leave-requests/:id/cancel — the requester withdraws it while it is pending.
    pub async fn cancel_leave_request(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let leave = load(&state, &tenant, id).await?;
        ensure_is(&state, &tenant, &user, leave.employee_id, "Only the requester may cancel this request").await?;
        let leave = state
            .leave_repo
            .transition_leave(&tenant.0, id, &[leave_status::PENDING], leave_status::CANCELLED, actor_name(&actor, &user), None)
            .await?
            .ok_or_else(|| AppError::Conflict(format!("This request is already {}", leave.status)))?;
        record(&state, &tenant, actor_name(&actor, &user), "leave_request.cancel", &leave, &None).await;
        Ok(Json(serde_json::to_value(leave).unwrap()))
    }

    /// POST /leave-requests/:id/reject — `{comment?}`.
    pub async fn reject_leave_request(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
        body: Option<Json<Decision>>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let comment = clean_comment(body);
        let leave = load(&state, &tenant, id).await?;
        let leave = state
            .leave_repo
            .transition_leave(&tenant.0, id, &[leave_status::PENDING], leave_status::REJECTED, actor_name(&actor, &user), comment.clone())
            .await?
            .ok_or_else(|| AppError::Conflict(format!("This request is already {}", leave.status)))?;
        record(&state, &tenant, actor_name(&actor, &user), "leave_request.reject", &leave, &comment).await;
        tell_requester(&state, &tenant, &leave, "rejected", &comment).await;
        Ok(Json(serde_json::to_value(leave).unwrap()))
    }

    /// POST /leave-requests/:id/approve — `{comment?}`. Writes the days as
    /// absences; limit warnings do not stop it, the ones present go to the audit entry.
    pub async fn approve_leave_request(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        change: RosterChange,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
        body: Option<Json<Decision>>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let comment = clean_comment(body);
        let pending = load(&state, &tenant, id).await?;
        let warnings = if pending.status == leave_status::PENDING {
            limit_warnings(&state, &tenant, &pending).await.unwrap_or_default()
        } else {
            Vec::new()
        };
        let ctx = change.ctx(&state, &tenant.0, ChangeSource::Absence).await?;
        let leave = state
            .leave_repo
            .approve_leave(&tenant.0, id, actor_name(&actor, &user), comment.clone(), &ctx)
            .await?;
        let mut audited = audit_changes(&leave, &comment).and_then(|s| serde_json::from_str::<Value>(&s).ok()).unwrap_or(Value::Null);
        audited["warnings"] = Value::Array(warnings);
        audit_log::record(&state, &tenant.0, actor_name(&actor, &user), "leave_request.approve", "leave_request", Some(leave.id.to_string()), Some(audited.to_string())).await;
        tell_requester(&state, &tenant, &leave, "approved", &comment).await;
        Ok(Json(serde_json::to_value(leave).unwrap()))
    }

    /// POST /leave-requests/:id/revoke — `{comment?}`. Takes an approved
    /// request back: the absences it created from today on are removed.
    pub async fn revoke_leave_request(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        change: RosterChange,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
        body: Option<Json<Decision>>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let comment = clean_comment(body);
        load(&state, &tenant, id).await?;
        let ctx = change.ctx(&state, &tenant.0, ChangeSource::Absence).await?;
        let leave = state
            .leave_repo
            .revoke_leave(&tenant.0, id, actor_name(&actor, &user), comment.clone(), &ctx)
            .await?;
        record(&state, &tenant, actor_name(&actor, &user), "leave_request.revoke", &leave, &comment).await;
        tell_requester(&state, &tenant, &leave, "revoked", &comment).await;
        Ok(Json(serde_json::to_value(leave).unwrap()))
    }

    /// GET /leave-blackouts — readable by everyone: the request form shows them.
    pub async fn list_blackouts(tenant: TenantContext, State(state): State<AppState>) -> Result<Json<Value>, AppError> {
        let rows = state.leave_repo.list_blackouts(&tenant.0).await?;
        Ok(Json(serde_json::to_value(rows).unwrap()))
    }

    /// POST /leave-blackouts — `{start_date, end_date, reason?}`.
    pub async fn create_blackout(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<CreateBlackout>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        if body.end_date < body.start_date {
            return Err(AppError::Validation("The end date is before the start date".into()));
        }
        let reason = body.reason.map(|r| r.trim().to_string()).filter(|r| !r.is_empty());
        let created = state
            .leave_repo
            .create_blackout(
                &tenant.0,
                NewLeaveBlackout { tenant_id: tenant.0.clone(), start_date: body.start_date, end_date: body.end_date, reason },
            )
            .await?;
        audit_log::record(
            &state,
            &tenant.0,
            actor_name(&actor, &user),
            "leave_blackout.create",
            "leave_blackout",
            Some(created.id.to_string()),
            Some(json!({ "start_date": created.start_date, "end_date": created.end_date, "reason": created.reason }).to_string()),
        )
        .await;
        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    /// DELETE /leave-blackouts/:id
    pub async fn delete_blackout(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        if !state.leave_repo.delete_blackout(&tenant.0, id).await? {
            return Err(AppError::NotFound);
        }
        audit_log::record(&state, &tenant.0, actor_name(&actor, &user), "leave_blackout.delete", "leave_blackout", Some(id.to_string()), None).await;
        Ok(Json(json!({ "message": "Blackout deleted" })))
    }

    /// GET /leave-limits — planners and admins.
    pub async fn list_limits(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let rows = state.leave_repo.list_limits(&tenant.0).await?;
        Ok(Json(serde_json::to_value(rows).unwrap()))
    }

    /// PUT /leave-limits — `{limits: [{capability_id, max_absent}]}` replaces them all.
    pub async fn update_limits(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<UpdateLimits>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let known: HashMap<Uuid, String> = state
            .capability_repo
            .list_capabilities(&tenant.0)
            .await?
            .into_iter()
            .map(|c| (c.id, c.name))
            .collect();
        let mut seen = std::collections::HashSet::new();
        for limit in &body.limits {
            if !known.contains_key(&limit.capability_id) {
                return Err(AppError::Validation(format!("No capability {}", limit.capability_id)));
            }
            if limit.max_absent < 0 {
                return Err(AppError::Validation("max_absent cannot be negative".into()));
            }
            if !seen.insert(limit.capability_id) {
                return Err(AppError::Validation("A capability may have only one limit".into()));
            }
        }
        let saved = state.leave_repo.replace_limits(&tenant.0, body.limits).await?;
        audit_log::record(
            &state,
            &tenant.0,
            actor_name(&actor, &user),
            "leave_limits.update",
            "leave_limits",
            None,
            Some(json!({ "limits": saved }).to_string()),
        )
        .await;
        Ok(Json(serde_json::to_value(saved).unwrap()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 12, day).unwrap()
    }

    fn blackout(from: u32, to: u32) -> LeaveBlackout {
        LeaveBlackout {
            id: Uuid::new_v4(),
            tenant_id: "t".into(),
            start_date: d(from),
            end_date: d(to),
            reason: Some("Christmas".into()),
            created_at: Default::default(),
        }
    }

    #[test]
    fn a_blackout_refuses_any_overlap_and_only_overlap() {
        let blackouts = [blackout(20, 31)];
        assert!(blackout_conflict(&blackouts, d(1), d(19)).is_none(), "ends before");
        assert!(blackout_conflict(&blackouts, d(19), d(20)).is_some(), "touches the first day");
        assert!(blackout_conflict(&blackouts, d(31), d(31)).is_some(), "touches the last day");
        assert!(blackout_conflict(&blackouts, d(22), d(23)).is_some(), "inside");
    }

    #[test]
    fn the_limit_counts_the_requester_as_one_more() {
        // At most 2 absent: with one peer out on the 10th, the requester makes 2 — fine;
        // with two peers out on the 11th, the requester would be a third.
        let peers = HashMap::from([(d(10), 1), (d(11), 2)]);
        assert_eq!(days_over_limit(d(9), d(12), 2, &peers), vec![d(11)]);
    }

    #[test]
    fn a_limit_of_zero_flags_every_day() {
        assert_eq!(days_over_limit(d(1), d(3), 0, &HashMap::new()), vec![d(1), d(2), d(3)]);
    }

    #[test]
    fn no_peers_absent_is_within_any_positive_limit() {
        assert!(days_over_limit(d(1), d(5), 1, &HashMap::new()).is_empty());
    }
}
