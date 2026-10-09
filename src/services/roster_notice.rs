//! `/roster-change-notices` — what changed in a published roster, per employee
//! and day, and who has seen it. Notices are written by the roster writes
//! themselves (`repository::rostertracking`); this only reads and acknowledges.
//!
//! A `shift-viewer` sees and acknowledges their own notices (matched by e-mail,
//! as for shift swaps); planners and admins see the whole tenant's, filtered.
//! Nobody acknowledges on someone else's behalf. The path is self-service
//! (`SELF_SERVICE_SEGMENTS`) so a viewer's acknowledgement gets through.

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::domain::{
    ChangeSource, EmployeeRepository, NoticeFilter, RosterChangeNotice, RosterChangeNoticeRepository, RosterEntry,
    ShiftRepository, WorkstationRepository,
};
use crate::repository::AppState;
use crate::services::shift_swap::caller_employee;
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

#[derive(Deserialize)]
pub struct ListNoticesQuery {
    /// Planners only; a viewer always gets their own.
    pub employee_id: Option<Uuid>,
    pub from_date: Option<NaiveDate>,
    pub to_date: Option<NaiveDate>,
    pub acknowledged: Option<bool>,
}

#[derive(Deserialize, Default)]
pub struct AcknowledgeRequest {
    /// Omitted or null: all of the caller's unacknowledged notices.
    pub ids: Option<Vec<Uuid>>,
}

/// An entry with the names a client shows, resolved when read.
#[derive(Serialize)]
pub struct EntryView {
    pub shift_id: Option<Uuid>,
    pub shift_name: Option<String>,
    pub workstation_id: Option<Uuid>,
    pub workstation_name: Option<String>,
    pub absence_type: Option<String>,
}

#[derive(Serialize)]
pub struct NoticeView {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub employee_name: Option<String>,
    pub date: NaiveDate,
    pub before: Option<EntryView>,
    pub after: Option<EntryView>,
    pub source: ChangeSource,
    pub actor: Option<String>,
    pub reason: Option<String>,
    pub created_at: NaiveDateTime,
    pub acknowledged_at: Option<NaiveDateTime>,
}

struct Names {
    employees: HashMap<Uuid, String>,
    shifts: HashMap<Uuid, String>,
    workstations: HashMap<Uuid, String>,
}

impl Names {
    async fn load(state: &AppState, tenant_id: &str, notices: &[RosterChangeNotice]) -> Result<Self, AppError> {
        let mut ids: Vec<Uuid> = notices.iter().map(|n| n.employee_id).collect();
        ids.sort();
        ids.dedup();
        let employees = state.employee_repo.list_employees_by_ids(tenant_id, &ids).await?;
        let shifts = state.shift_repo.list_shifts(tenant_id).await?;
        let workstations = state.workstation_repo.list_workstations(tenant_id).await?;
        Ok(Self {
            employees: employees.into_iter().map(|e| (e.id, e.name)).collect(),
            shifts: shifts.into_iter().map(|s| (s.id, s.name)).collect(),
            workstations: workstations.into_iter().map(|w| (w.id, w.name)).collect(),
        })
    }

    fn entry(&self, entry: Option<RosterEntry>) -> Option<EntryView> {
        entry.map(|e| EntryView {
            shift_name: e.shift_id.and_then(|id| self.shifts.get(&id).cloned()),
            workstation_name: e.workstation_id.and_then(|id| self.workstations.get(&id).cloned()),
            shift_id: e.shift_id,
            workstation_id: e.workstation_id,
            absence_type: e.absence_type,
        })
    }

    fn view(&self, n: RosterChangeNotice) -> NoticeView {
        NoticeView {
            id: n.id,
            employee_id: n.employee_id,
            employee_name: self.employees.get(&n.employee_id).cloned(),
            date: n.date,
            before: self.entry(n.before),
            after: self.entry(n.after),
            source: n.source,
            actor: n.actor,
            reason: n.reason,
            created_at: n.created_at,
            acknowledged_at: n.acknowledged_at,
        }
    }
}

pub struct RosterNoticeService;

impl RosterNoticeService {
    /// GET /roster-change-notices — newest first. A viewer gets their own; a
    /// planner every notice of the tenant, by `employee_id`, date range and
    /// `acknowledged`.
    pub async fn list_notices(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        Query(q): Query<ListNoticesQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<NoticeView>>, AppError> {
        let employee_id = if roles.can_write() {
            q.employee_id
        } else {
            match caller_employee(&state, &tenant, &user).await? {
                Some(me) => Some(me.id),
                None => return Ok(Json(vec![])),
            }
        };
        let filter = NoticeFilter { employee_id, from_date: q.from_date, to_date: q.to_date, acknowledged: q.acknowledged };
        let notices = state.roster_notice_repo.list_notices(&tenant.0, filter).await?;
        let names = Names::load(&state, &tenant.0, &notices).await?;
        Ok(Json(notices.into_iter().map(|n| names.view(n)).collect()))
    }

    /// GET /roster-change-notices/unread-count — the caller's own, for the bell.
    /// 0 for a caller who is no employee.
    pub async fn unread_count(
        tenant: TenantContext,
        user: UserContext,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let count = match caller_employee(&state, &tenant, &user).await? {
            Some(me) => state.roster_notice_repo.count_unacknowledged(&tenant.0, me.id).await?,
            None => 0,
        };
        Ok(Json(json!({ "count": count })))
    }

    /// POST /roster-change-notices/acknowledge — `{ids?}`: the caller's own
    /// notices (all unacknowledged ones without `ids`). Refused when any of
    /// `ids` is about someone else.
    pub async fn acknowledge(
        tenant: TenantContext,
        user: UserContext,
        State(state): State<AppState>,
        body: Option<Json<AcknowledgeRequest>>,
    ) -> Result<Json<Value>, AppError> {
        let Some(me) = caller_employee(&state, &tenant, &user).await? else {
            return Err(AppError::Forbidden("Only the employee a notice is about may acknowledge it".into()));
        };
        let ids = body.and_then(|Json(b)| b.ids);
        let acknowledged = state.roster_notice_repo.acknowledge_notices(&tenant.0, me.id, ids).await?;
        Ok(Json(json!({ "acknowledged": acknowledged })))
    }
}
