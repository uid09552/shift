//! Shift swaps: a `shift-viewer` offers one of their confirmed shifts for one of
//! a colleague's, the colleague accepts or declines, and a `shift-planner` or
//! `shift-admin` approves — which exchanges the two roster rows — or rejects.
//!
//! The path is self-service (`SELF_SERVICE_SEGMENTS`), so every mutation reaches
//! these handlers whatever the caller's role; each one checks who may take it:
//!
//! | action            | who                                              |
//! |-------------------|--------------------------------------------------|
//! | create            | the requester themselves, never a planner/admin  |
//! | cancel            | the requester, while the request is pending      |
//! | accept / decline  | the colleague named in the request               |
//! | approve / reject  | `shift-planner` / `shift-admin`                  |
//!
//! People are matched to employees by e-mail, as for shift wishes. No rule is
//! checked when a request is made or approved: the planner sees the rule
//! warnings (from the agent, see `swap_warnings`) and decides. Requests whose
//! earlier date has passed expire; that is written on the next read.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{Local, NaiveDate};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::{
    swap_roster_conflict, swap_status, ConfirmedShiftPlanRepository, Employee, EmployeeRepository,
    ShiftSwapRepository, ShiftSwapRequest, SwapApproval, SwapSide,
};
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

/// How long the planner's review waits for the agent's rule check.
const AGENT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
pub struct ListShiftSwapsQuery {
    pub status: Option<String>,
    /// Planners only: the requests this employee is requester or colleague in.
    pub employee_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct CreateShiftSwap {
    pub requester_id: Uuid,
    pub requester_date: NaiveDate,
    pub colleague_id: Uuid,
    pub colleague_date: NaiveDate,
}

pub struct ShiftSwapService;

fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// Who decided, for `decided_by` and the audit log: the gateway's user info if
/// present, else the token's own identity.
fn actor_name(actor: &AuditActor, user: &UserContext) -> Option<String> {
    actor
        .0
        .clone()
        .or_else(|| user.username.clone())
        .or_else(|| user.email.clone())
        .or_else(|| user.subject.clone())
}

/// The employee the caller is, matched by e-mail (either token claim).
async fn caller_employee(
    state: &AppState,
    tenant: &TenantContext,
    user: &UserContext,
) -> Result<Option<Employee>, AppError> {
    for claim in [&user.email, &user.username].into_iter().flatten() {
        if let Some(employee) = state.employee_repo.get_employee_by_email(&tenant.0, claim).await? {
            return Ok(Some(employee));
        }
    }
    Ok(None)
}

async fn employee(state: &AppState, tenant: &TenantContext, id: Uuid) -> Result<Employee, AppError> {
    state
        .employee_repo
        .get_employee(&tenant.0, id)
        .await?
        .ok_or_else(|| AppError::Validation(format!("No employee {id}")))
}

/// Pending requests whose date has passed become `expired` before anyone looks.
async fn expire(state: &AppState, tenant: &TenantContext) -> Result<(), AppError> {
    state.shift_swap_repo.expire_swaps(&tenant.0, today()).await.map(|_| ())
}

async fn load(state: &AppState, tenant: &TenantContext, id: Uuid) -> Result<ShiftSwapRequest, AppError> {
    expire(state, tenant).await?;
    state.shift_swap_repo.get_swap(&tenant.0, id).await?.ok_or(AppError::NotFound)
}

/// The confirmed rows of both people on both dates.
async fn roster_rows(
    state: &AppState,
    tenant: &TenantContext,
    people: [Uuid; 2],
    dates: [NaiveDate; 2],
) -> Result<Vec<crate::repository::domain::ConfirmedShiftPlan>, AppError> {
    let (from, to) = (dates[0].min(dates[1]), dates[0].max(dates[1]));
    let mut rows = Vec::new();
    for employee_id in people {
        rows.extend(
            state
                .confirmed_shift_plan_repo
                .get_confirmed_shift_plans_for_employee_in_range(&tenant.0, employee_id, from, to)
                .await?
                .into_iter()
                .filter(|r| dates.contains(&r.date)),
        );
    }
    Ok(rows)
}

/// The shift `employee` works on `date` in the confirmed roster.
fn side_from_roster(
    employee: &Employee,
    date: NaiveDate,
    rows: &[crate::repository::domain::ConfirmedShiftPlan],
) -> Result<SwapSide, AppError> {
    rows.iter()
        .find(|r| r.employee_id == employee.id && r.date == date && r.is_working())
        .and_then(|r| {
            Some(SwapSide {
                employee_id: employee.id,
                date,
                shift_id: r.shift_id?,
                workstation_id: r.workstation_id,
            })
        })
        .ok_or_else(|| {
            AppError::Validation(format!("{} has no shift on {date} in the confirmed roster", employee.name))
        })
}

/// Fails unless the caller is the employee `id`.
async fn ensure_is(
    state: &AppState,
    tenant: &TenantContext,
    user: &UserContext,
    id: Uuid,
    refusal: &str,
) -> Result<Employee, AppError> {
    let employee = employee(state, tenant, id).await?;
    if user.matches_email(&employee.email) {
        Ok(employee)
    } else {
        Err(AppError::Forbidden(refusal.to_string()))
    }
}

fn ensure_planner(roles: &RoleContext) -> Result<(), AppError> {
    if roles.can_write() {
        Ok(())
    } else {
        Err(AppError::Forbidden("Only a planner or an admin may decide on a shift swap".into()))
    }
}

/// Moves `swap` from one of `from` to `to`, or explains why it cannot.
async fn transition(
    state: &AppState,
    tenant: &TenantContext,
    swap: &ShiftSwapRequest,
    from: &[&str],
    to: &str,
    decided_by: Option<String>,
) -> Result<ShiftSwapRequest, AppError> {
    state
        .shift_swap_repo
        .transition_swap(&tenant.0, swap.id, from, to, decided_by)
        .await?
        .ok_or_else(|| AppError::Conflict(format!("This swap is already {}", swap.status)))
}

fn audit_changes(swap: &ShiftSwapRequest, extra: Option<(&str, Value)>) -> Option<String> {
    let mut changes = json!({
        "status": swap.status,
        "requester": swap.requester,
        "colleague": swap.colleague,
    });
    if let Some((key, value)) = extra {
        changes[key] = value;
    }
    Some(changes.to_string())
}

async fn record(
    state: &AppState,
    tenant: &TenantContext,
    actor: Option<String>,
    action: &str,
    swap: &ShiftSwapRequest,
    extra: Option<(&str, Value)>,
) {
    audit_log::record(
        state,
        &tenant.0,
        actor,
        action,
        "shift_swap",
        Some(swap.id.to_string()),
        audit_changes(swap, extra),
    )
    .await;
}

/// The rule violations the exchange would cause, per employee, from the agent's
/// `/roster/swap-check` — the same checks as a short-notice replacement. Asked
/// with the caller's own token, so the agent reads the roster as them.
///
/// `Err` carries a reason to show instead; warnings never gate a decision.
pub async fn swap_warnings(state: &AppState, headers: &HeaderMap, swap: &ShiftSwapRequest) -> Result<Value, String> {
    if state.agent_url.is_empty() {
        return Err("Rule checks are not configured (agent.url)".into());
    }
    let side = |s: &SwapSide| json!({ "employee_id": s.employee_id, "date": s.date });
    let mut request = reqwest::Client::new()
        .post(format!("{}/api/v1/roster/swap-check", state.agent_url))
        .timeout(AGENT_TIMEOUT)
        .json(&json!({ "requester": side(&swap.requester), "colleague": side(&swap.colleague) }));
    if let Some(token) = headers.get("x-access-token") {
        request = request.header("x-access-token", token.clone());
    }
    let response = request.send().await.map_err(|e| format!("The rule check is unavailable: {e}"))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(body["error"].as_str().map(str::to_string).unwrap_or_else(|| format!("The rule check answered {status}")));
    }
    Ok(body["employees"].clone())
}

/// The request as the API returns it, with warnings for a planner reviewing it.
async fn detail(state: &AppState, headers: &HeaderMap, roles: &RoleContext, swap: &ShiftSwapRequest) -> Value {
    let mut body = serde_json::to_value(swap).unwrap();
    if roles.can_write() && swap.status == swap_status::PENDING_PLANNER {
        match swap_warnings(state, headers, swap).await {
            Ok(warnings) => body["warnings"] = warnings,
            Err(reason) => body["warnings_error"] = Value::String(reason),
        }
    }
    body
}

impl ShiftSwapService {
    /// GET /shift-swaps — planners see the tenant's requests, everyone else
    /// only those they are requester or colleague in.
    pub async fn list_shift_swaps(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        Query(q): Query<ListShiftSwapsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        expire(&state, &tenant).await?;
        let employee_id = if roles.can_write() {
            q.employee_id
        } else {
            match caller_employee(&state, &tenant, &user).await? {
                Some(me) => Some(me.id),
                None => return Ok(Json(json!([]))),
            }
        };
        let swaps = state.shift_swap_repo.list_swaps(&tenant.0, employee_id, q.status).await?;
        Ok(Json(serde_json::to_value(swaps).unwrap()))
    }

    /// GET /shift-swaps/pending-count — how many await a planner. Planners only:
    /// it drives their notification.
    pub async fn pending_count(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        expire(&state, &tenant).await?;
        let count = state
            .shift_swap_repo
            .count_swaps_with_status(&tenant.0, swap_status::PENDING_PLANNER)
            .await?;
        Ok(Json(json!({ "count": count })))
    }

    /// GET /shift-swaps/:id — with `warnings` (or `warnings_error`) when a
    /// planner looks at a request awaiting their decision.
    pub async fn get_shift_swap(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        headers: HeaderMap,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let swap = load(&state, &tenant, id).await?;
        if !roles.can_write() {
            let me = caller_employee(&state, &tenant, &user).await?;
            let involved = me.is_some_and(|me| me.id == swap.requester.employee_id || me.id == swap.colleague.employee_id);
            if !involved {
                return Err(AppError::NotFound);
            }
        }
        Ok(Json(detail(&state, &headers, &roles, &swap).await))
    }

    /// POST /shift-swaps — `{requester_id, requester_date, colleague_id, colleague_date}`.
    /// The shifts are taken from the confirmed roster on those dates.
    pub async fn create_shift_swap(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<CreateShiftSwap>,
    ) -> Result<Json<Value>, AppError> {
        // A planner's request would need nobody's consent but their own.
        if roles.can_write() {
            return Err(AppError::Forbidden(
                "Planners and admins decide on shift swaps; only employees request them".into(),
            ));
        }
        let requester = ensure_is(&state, &tenant, &user, body.requester_id, "You may only offer your own shifts").await?;
        if body.colleague_id == body.requester_id {
            return Err(AppError::Validation("Pick a colleague to swap with".into()));
        }
        let colleague = employee(&state, &tenant, body.colleague_id).await?;
        let today = today();
        for date in [body.requester_date, body.colleague_date] {
            if date < today {
                return Err(AppError::Validation(format!("{date} has passed")));
            }
        }

        let dates = [body.requester_date, body.colleague_date];
        let rows = roster_rows(&state, &tenant, [requester.id, colleague.id], dates).await?;
        let mine = side_from_roster(&requester, body.requester_date, &rows)?;
        let theirs = side_from_roster(&colleague, body.colleague_date, &rows)?;
        let name = |id: Uuid| if id == requester.id { requester.name.clone() } else { colleague.name.clone() };
        if let Some(reason) = swap_roster_conflict(&mine, &theirs, &rows, name) {
            return Err(AppError::Validation(reason));
        }

        let swap = state.shift_swap_repo.create_swap(&tenant.0, mine, theirs).await?;
        record(&state, &tenant, actor_name(&actor, &user), "shift_swap.create", &swap, None).await;
        Ok(Json(serde_json::to_value(swap).unwrap()))
    }

    /// POST /shift-swaps/:id/accept — the colleague agrees; the request goes to a planner.
    pub async fn accept_shift_swap(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        Self::answer(tenant, user, actor, id, state, swap_status::PENDING_PLANNER, "shift_swap.accept").await
    }

    /// POST /shift-swaps/:id/decline — the colleague says no; the roster stays as it is.
    pub async fn decline_shift_swap(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        Self::answer(tenant, user, actor, id, state, swap_status::REJECTED, "shift_swap.decline").await
    }

    async fn answer(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        id: Uuid,
        state: AppState,
        to: &str,
        action: &str,
    ) -> Result<Json<Value>, AppError> {
        let swap = load(&state, &tenant, id).await?;
        ensure_is(&state, &tenant, &user, swap.colleague.employee_id, "Only the colleague asked may answer this request").await?;
        let swap = transition(&state, &tenant, &swap, &[swap_status::PENDING_COLLEAGUE], to, actor_name(&actor, &user)).await?;
        record(&state, &tenant, actor_name(&actor, &user), action, &swap, None).await;
        Ok(Json(serde_json::to_value(swap).unwrap()))
    }

    /// POST /shift-swaps/:id/cancel — the requester withdraws it while it is pending.
    pub async fn cancel_shift_swap(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let swap = load(&state, &tenant, id).await?;
        ensure_is(&state, &tenant, &user, swap.requester.employee_id, "Only the requester may cancel this request").await?;
        let swap = transition(&state, &tenant, &swap, &swap_status::PENDING, swap_status::CANCELLED, actor_name(&actor, &user)).await?;
        record(&state, &tenant, actor_name(&actor, &user), "shift_swap.cancel", &swap, None).await;
        Ok(Json(serde_json::to_value(swap).unwrap()))
    }

    /// POST /shift-swaps/:id/reject — a planner says no; the roster stays as it is.
    pub async fn reject_shift_swap(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let swap = load(&state, &tenant, id).await?;
        let swap = transition(&state, &tenant, &swap, &[swap_status::PENDING_PLANNER], swap_status::REJECTED, actor_name(&actor, &user)).await?;
        record(&state, &tenant, actor_name(&actor, &user), "shift_swap.reject", &swap, None).await;
        Ok(Json(serde_json::to_value(swap).unwrap()))
    }

    /// POST /shift-swaps/:id/approve — a planner says yes: the two roster rows
    /// are exchanged in one transaction, unless either has changed since the
    /// request was made (409, and the request is marked `stale`). Rule warnings
    /// do not stop it; the ones present are written to the audit entry.
    pub async fn approve_shift_swap(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        headers: HeaderMap,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let swap = load(&state, &tenant, id).await?;
        if swap.status != swap_status::PENDING_PLANNER {
            return Err(AppError::Conflict(format!("This swap is {}, not awaiting a planner's decision", swap.status)));
        }
        let warnings = swap_warnings(&state, &headers, &swap).await.unwrap_or_else(|reason| json!({ "unavailable": reason }));
        let decided_by = actor_name(&actor, &user);

        match state.shift_swap_repo.approve_swap(&tenant.0, id, decided_by.clone()).await? {
            SwapApproval::Approved(swap) => {
                record(&state, &tenant, decided_by, "shift_swap.approve", &swap, Some(("warnings", warnings))).await;
                Ok(Json(serde_json::to_value(swap).unwrap()))
            }
            SwapApproval::Stale(swap, reason) => {
                record(&state, &tenant, decided_by, "shift_swap.stale", &swap, Some(("reason", Value::String(reason.clone())))).await;
                Err(AppError::Conflict(reason))
            }
        }
    }
}
