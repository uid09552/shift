//! Open shifts: a slot nobody is planned on, offered to the people who could
//! take it. Qualified employees volunteer, a `shift-planner` or `shift-admin`
//! assigns one of them — which writes the shift into the confirmed roster, under
//! the roster guard like every roster write (a reason inside the freeze window
//! of a published month, an admin for a locked one, a change notice).
//!
//! The path is self-service (`SELF_SERVICE_SEGMENTS`), so every mutation reaches
//! these handlers whatever the caller's role; each one checks who may take it:
//!
//! | action              | who                                              |
//! |---------------------|--------------------------------------------------|
//! | post, assign, close | `shift-planner` / `shift-admin`                  |
//! | volunteer, withdraw | the employee themselves, never a planner/admin   |
//!
//! **Who may take a slot** is one function, `ineligible_reasons`: not working or
//! absent that day, not marked unavailable, available for the shift, holding the
//! workstation's capabilities (or a higher level of the same group), and the
//! planner's minimum rest to the neighbouring days. An employee who fails any of
//! them cannot volunteer, and is told which; a planner cannot assign them.
//! What this does not know — the labor-law profile, personal limits — the plan
//! check (`/agent/plan/validate`) reports once the shift is in the roster.
//!
//! Gaps: `GET /open-shifts/gaps` lists the slots of the confirmed roster that are
//! below their workstation's minimum, ready to be offered.

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{NewOpenShift, OpenShift, OpenShiftVolunteer};
use crate::repository::domain::{
    open_shift_status, ChangeSource, Capability, ConfirmedShiftPlan, ConfirmedShiftPlanRepository, Employee,
    EmployeeRepository, OpenShiftRepository, PlannerSettingsRepository, Shift, ShiftRepository, Unavailability,
    UnavailabilityRepository, WorkstationRepository, WorkstationUnavailabilityRepository,
};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::notifier;
use crate::services::roster_guard::RosterChange;
use crate::services::shift_swap::{actor_name, caller_employee, ensure_planner, today};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

const MAX_NOTE_CHARS: usize = 500;

#[derive(Deserialize)]
pub struct ListOpenShiftsQuery {
    /// Comma-separated; `open` when absent.
    pub status: Option<String>,
    pub from: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub struct CreateOpenShift {
    pub date: NaiveDate,
    pub shift_id: Uuid,
    pub workstation_id: Option<Uuid>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct AssignOpenShift {
    pub employee_id: Uuid,
}

#[derive(Deserialize)]
pub struct GapsQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

// --- eligibility --------------------------------------------------------------

/// What the rules need to know about the world around one slot.
pub struct Facts<'a> {
    pub date: NaiveDate,
    pub shift: &'a Shift,
    pub required: &'a [Capability],
    pub shifts: &'a HashMap<Uuid, Shift>,
    /// The confirmed roster from the day before to the day after.
    pub roster: &'a [ConfirmedShiftPlan],
    /// Hard whole-day or shift-specific unavailabilities on `date`.
    pub unavailable: &'a [Unavailability],
    /// `0` = the rule is off.
    pub min_rest_hours: f64,
}

/// When `shift` starts and ends on `date`; an end at or before the start runs into the next day.
pub fn shift_span(shift: &Shift, date: NaiveDate) -> Option<(NaiveDateTime, NaiveDateTime)> {
    let weekday = date.weekday().num_days_from_monday() as i16;
    let time = shift.weekday_times.iter().find(|t| t.weekday == weekday)?;
    let start = date.and_time(time.start_time);
    let mut end = date.and_time(time.end_time);
    if end <= start {
        end += Duration::days(1);
    }
    Some((start, end))
}

/// A required capability is met by holding it, or a higher level of its skill group.
fn covers(have: &[Capability], need: &Capability) -> bool {
    have.iter().any(|c| {
        c.id == need.id
            || (need.skill_group.is_some() && c.skill_group == need.skill_group && c.level >= need.level)
    })
}

/// Why `employee` may not take the slot; empty when they may.
pub fn ineligible_reasons(employee: &Employee, facts: &Facts) -> Vec<String> {
    let mut reasons = Vec::new();
    let mine = |row: &&ConfirmedShiftPlan| row.employee_id == employee.id;

    let same_day: Vec<&ConfirmedShiftPlan> = facts.roster.iter().filter(mine).filter(|r| r.date == facts.date).collect();
    if same_day.iter().any(|r| r.is_working()) {
        reasons.push("Already working that day".to_string());
    } else if let Some(absence) = same_day.iter().find_map(|r| r.absence_type.as_deref().filter(|a| *a != "free")) {
        reasons.push(format!("Absent that day ({})", absence.replace('_', " ")));
    }

    if facts
        .unavailable
        .iter()
        .any(|u| u.employee_id == employee.id && !u.is_soft_preference && u.shift_id.is_none_or(|s| s == facts.shift.id))
    {
        reasons.push("Marked unavailable that day".to_string());
    }

    if !employee.available_shifts.iter().any(|s| s.id == facts.shift.id) {
        reasons.push(format!("Not available for the {} shift", facts.shift.name));
    }

    // Only what is still valid that day counts (a lapsed certificate does not).
    let held: Vec<Capability> = employee.capabilities.iter().filter(|c| c.valid_on(facts.date)).cloned().collect();
    let missing: Vec<&str> = facts
        .required
        .iter()
        .filter(|need| !covers(&held, need))
        .map(|need| need.name.as_str())
        .collect();
    if !missing.is_empty() {
        reasons.push(format!("Lacks {}", missing.join(", ")));
    }

    if facts.min_rest_hours > 0.0 {
        if let Some((start, end)) = shift_span(facts.shift, facts.date) {
            let neighbour = |date: NaiveDate| -> Option<(NaiveDateTime, NaiveDateTime)> {
                let row = facts.roster.iter().find(|r| r.employee_id == employee.id && r.date == date && r.is_working())?;
                shift_span(facts.shifts.get(&row.shift_id?)?, date)
            };
            let hours = |from: NaiveDateTime, to: NaiveDateTime| (to - from).num_minutes() as f64 / 60.0;
            if let Some(date) = facts.date.pred_opt() {
                if let Some((_, previous_end)) = neighbour(date) {
                    let rest = hours(previous_end, start);
                    if rest < facts.min_rest_hours {
                        reasons.push(format!("Only {rest:.1} h rest after the previous day's shift"));
                    }
                }
            }
            if let Some(date) = facts.date.succ_opt() {
                if let Some((next_start, _)) = neighbour(date) {
                    let rest = hours(end, next_start);
                    if rest < facts.min_rest_hours {
                        reasons.push(format!("Only {rest:.1} h rest before the next day's shift"));
                    }
                }
            }
        }
    }
    reasons
}

/// The world around a set of open shifts, loaded once.
struct Surroundings {
    /// Recurring availability per employee; a hard rule rules them out.
    availability: HashMap<Uuid, Vec<crate::models::AvailabilityRule>>,
    shifts: HashMap<Uuid, Shift>,
    workstations: HashMap<Uuid, Vec<Capability>>,
    roster: Vec<ConfirmedShiftPlan>,
    unavailable: Vec<Unavailability>,
    min_rest_hours: f64,
}

impl Surroundings {
    async fn load(state: &AppState, tenant: &str, from: NaiveDate, to: NaiveDate) -> Result<Self, AppError> {
        let shifts = state.shift_repo.list_shifts(tenant).await?.into_iter().map(|s| (s.id, s)).collect();
        let workstations = state
            .workstation_repo
            .list_workstations(tenant)
            .await?
            .into_iter()
            .map(|w| (w.id, w.required_capabilities))
            .collect();
        let roster = state
            .confirmed_shift_plan_repo
            .get_confirmed_shift_plans_for_date_range(
                tenant,
                from.pred_opt().unwrap_or(from),
                to.succ_opt().unwrap_or(to),
                None,
                None,
                false,
            )
            .await?;
        let unavailable = state
            .unavailability_repo
            .list_unavailabilities(tenant)
            .await?
            .into_iter()
            .filter(|u| u.unavailable_date >= from && u.unavailable_date <= to)
            .collect();
        let min_rest_hours = state.planner_settings_repo.get_or_create_planner_settings(tenant).await?.min_rest_hours;
        let mut availability: HashMap<Uuid, Vec<crate::models::AvailabilityRule>> = HashMap::new();
        {
            use crate::repository::domain::AvailabilityRuleRepository;
            for rule in state.staffing_rule_repo.list_availability_rules(tenant, None).await? {
                availability.entry(rule.employee_id).or_default().push(rule);
            }
        }
        Ok(Self { availability, shifts, workstations, roster, unavailable, min_rest_hours })
    }

    /// The reasons `employee` may not take `open`; empty when they may.
    fn reasons(&self, employee: &Employee, open: &OpenShift) -> Vec<String> {
        let Some(shift) = self.shifts.get(&open.shift_id) else {
            return vec!["The shift no longer exists".to_string()];
        };
        let required = open
            .workstation_id
            .and_then(|w| self.workstations.get(&w))
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let unavailable: Vec<Unavailability> =
            self.unavailable.iter().filter(|u| u.unavailable_date == open.date).cloned().collect();
        let mut reasons = ineligible_reasons(
            employee,
            &Facts {
                date: open.date,
                shift,
                required,
                shifts: &self.shifts,
                roster: &self.roster,
                unavailable: &unavailable,
                min_rest_hours: self.min_rest_hours,
            },
        );
        let rules = self.availability.get(&employee.id).map(Vec::as_slice).unwrap_or(&[]);
        if crate::services::availability::hard_block(rules, open.date, open.shift_id).is_some() {
            reasons.push("Not available for this shift that day (standing availability)".to_string());
        }
        reasons
    }
}

// --- handlers -------------------------------------------------------------------

async fn load(state: &AppState, tenant: &TenantContext, id: Uuid) -> Result<OpenShift, AppError> {
    state.open_shift_repo.get_open_shift(&tenant.0, id).await?.ok_or(AppError::NotFound)
}

fn audit_changes(open: &OpenShift, employee_id: Option<Uuid>) -> Option<String> {
    Some(
        json!({
            "status": open.status,
            "date": open.date,
            "shift_id": open.shift_id,
            "workstation_id": open.workstation_id,
            "employee_id": employee_id,
        })
        .to_string(),
    )
}

async fn record(state: &AppState, tenant: &TenantContext, actor: Option<String>, action: &str, open: &OpenShift, employee_id: Option<Uuid>) {
    audit_log::record(state, &tenant.0, actor, action, "open_shift", Some(open.id.to_string()), audit_changes(open, employee_id)).await;
}

fn slot_text(open: &OpenShift, shifts: &HashMap<Uuid, Shift>) -> String {
    let name = shifts.get(&open.shift_id).map(|s| s.name.as_str()).unwrap_or("shift");
    format!("{name} on {}", open.date)
}

fn refusal(prefix: &str, reasons: &[String]) -> AppError {
    AppError::Validation(format!("{prefix}: {}", reasons.join("; ")))
}

pub struct OpenShiftService;

impl OpenShiftService {
    /// GET /open-shifts — `open` ones from today on unless `status`/`from` say otherwise.
    ///
    /// Everyone sees the slots and whether *they* may take it (`eligible`,
    /// `reasons`) and whether they have volunteered. Planners also get the
    /// volunteers, each with the same check.
    pub async fn list_open_shifts(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        Query(q): Query<ListOpenShiftsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let statuses: Vec<String> = match q.status.as_deref() {
            Some(s) => s.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect(),
            None => vec![open_shift_status::OPEN.to_string()],
        };
        let from = q.from.or_else(|| statuses.iter().all(|s| s == open_shift_status::OPEN).then(today));
        let offers = state.open_shift_repo.list_open_shifts(&tenant.0, &statuses, from).await?;
        if offers.is_empty() {
            return Ok(Json(json!([])));
        }
        let ids: Vec<Uuid> = offers.iter().map(|o| o.id).collect();
        let volunteers = state.open_shift_repo.list_volunteers(&tenant.0, &ids).await?;
        let first = offers.iter().map(|o| o.date).min().expect("not empty");
        let last = offers.iter().map(|o| o.date).max().expect("not empty");
        let around = Surroundings::load(&state, &tenant.0, first, last).await?;

        let planner = roles.can_write();
        let me = if planner { None } else { caller_employee(&state, &tenant, &user).await? };
        let people: HashMap<Uuid, Employee> = if planner {
            state.employee_repo.list_employees(&tenant.0, None, None).await?.into_iter().map(|e| (e.id, e)).collect()
        } else {
            HashMap::new()
        };

        let mut out = Vec::with_capacity(offers.len());
        for offer in &offers {
            let of_offer: Vec<&OpenShiftVolunteer> = volunteers.iter().filter(|v| v.open_shift_id == offer.id).collect();
            let mut body = serde_json::to_value(offer).unwrap();
            body["volunteer_count"] = json!(of_offer.len());
            if planner {
                body["volunteers"] = Value::Array(
                    of_offer
                        .iter()
                        .map(|v| {
                            let reasons = people.get(&v.employee_id).map(|e| around.reasons(e, offer)).unwrap_or_default();
                            json!({ "employee_id": v.employee_id, "created_at": v.created_at, "eligible": reasons.is_empty(), "reasons": reasons })
                        })
                        .collect(),
                );
            } else {
                let reasons = match &me {
                    Some(me) => around.reasons(me, offer),
                    None => vec!["No employee matches your account".to_string()],
                };
                body["volunteered"] = json!(me.as_ref().is_some_and(|me| of_offer.iter().any(|v| v.employee_id == me.id)));
                body["eligible"] = json!(reasons.is_empty());
                body["reasons"] = json!(reasons);
            }
            out.push(body);
        }
        Ok(Json(Value::Array(out)))
    }

    /// GET /open-shifts/count — how many offers are open from today on; drives the badge.
    pub async fn open_count(tenant: TenantContext, State(state): State<AppState>) -> Result<Json<Value>, AppError> {
        let offers = state
            .open_shift_repo
            .list_open_shifts(&tenant.0, &[open_shift_status::OPEN.to_string()], Some(today()))
            .await?;
        Ok(Json(json!({ "count": offers.len() })))
    }

    /// GET /open-shifts/gaps?from&to — slots of the confirmed roster below their
    /// workstation's minimum that have no open offer yet. Planners only.
    pub async fn gaps(
        tenant: TenantContext,
        roles: RoleContext,
        Query(q): Query<GapsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        if q.to < q.from {
            return Err(AppError::Validation("The end date is before the start date".into()));
        }
        if (q.to - q.from).num_days() > 92 {
            return Err(AppError::Validation("Look at three months at most".into()));
        }
        let shifts: HashMap<Uuid, Shift> = state.shift_repo.list_shifts(&tenant.0).await?.into_iter().map(|s| (s.id, s)).collect();
        let workstations = state.workstation_repo.list_workstations(&tenant.0).await?;
        let closures = state.workstation_unavailability_repo.list_workstation_unavailabilities(&tenant.0).await?;
        let roster = state
            .confirmed_shift_plan_repo
            .get_confirmed_shift_plans_for_date_range(&tenant.0, q.from, q.to, None, None, false)
            .await?;
        let open: HashSet<(NaiveDate, Uuid, Option<Uuid>)> = state
            .open_shift_repo
            .list_open_shifts(&tenant.0, &[open_shift_status::OPEN.to_string()], Some(q.from))
            .await?
            .into_iter()
            .map(|o| (o.date, o.shift_id, o.workstation_id))
            .collect();

        let mut staffed: HashMap<(NaiveDate, Uuid, Uuid), i64> = HashMap::new();
        for row in roster.iter().filter(|r| r.is_working()) {
            if let (Some(shift), Some(workstation)) = (row.shift_id, row.workstation_id) {
                *staffed.entry((row.date, shift, workstation)).or_default() += 1;
            }
        }

        let mut gaps = Vec::new();
        for workstation in workstations.iter().filter(|w| w.available && w.min_employees > 0) {
            for shift_id in &workstation.active_shift_ids {
                let Some(shift) = shifts.get(shift_id) else { continue };
                let mut date = q.from;
                while date <= q.to {
                    let weekday = date.weekday().num_days_from_monday() as i16;
                    let runs = shift.weekday_times.iter().any(|t| t.weekday == weekday);
                    let closed = closures
                        .iter()
                        .any(|c| c.workstation_id == workstation.id && c.unavailable_from <= date && date <= c.unavailable_to);
                    let have = staffed.get(&(date, *shift_id, workstation.id)).copied().unwrap_or(0);
                    let short = i64::from(workstation.min_employees) - have;
                    if runs && !closed && short > 0 && !open.contains(&(date, *shift_id, Some(workstation.id))) {
                        gaps.push(json!({
                            "date": date,
                            "shift_id": shift_id,
                            "workstation_id": workstation.id,
                            "short": short,
                            "min_employees": workstation.min_employees,
                        }));
                    }
                    date = date.succ_opt().expect("date in range");
                }
            }
        }
        gaps.sort_by_key(|g| g["date"].as_str().map(str::to_string));
        Ok(Json(Value::Array(gaps)))
    }

    /// POST /open-shifts — `{date, shift_id, workstation_id?, note?}`. Offers the
    /// slot and tells the employees who may take it.
    pub async fn create_open_shift(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<CreateOpenShift>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        if body.date < today() {
            return Err(AppError::Validation(format!("{} has passed", body.date)));
        }
        let shift = state.shift_repo.get_shift(&tenant.0, body.shift_id).await?.ok_or_else(|| AppError::Validation("No such shift".into()))?;
        if let Some(workstation_id) = body.workstation_id {
            let workstation = state
                .workstation_repo
                .get_workstation(&tenant.0, workstation_id)
                .await?
                .ok_or_else(|| AppError::Validation("No such workstation".into()))?;
            if !workstation.active_shift_ids.contains(&shift.id) {
                return Err(AppError::Validation(format!("{} does not run the {} shift", workstation.name, shift.name)));
            }
        }
        let note = body.note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if note.as_ref().is_some_and(|n| n.chars().count() > MAX_NOTE_CHARS) {
            return Err(AppError::Validation(format!("The note may be at most {MAX_NOTE_CHARS} characters")));
        }

        let who = actor_name(&actor, &user);
        let offer = match state
            .open_shift_repo
            .create_open_shift(
                &tenant.0,
                NewOpenShift {
                    tenant_id: tenant.0.clone(),
                    date: body.date,
                    shift_id: body.shift_id,
                    workstation_id: body.workstation_id,
                    note,
                    created_by: who.clone(),
                },
            )
            .await
        {
            Ok(offer) => offer,
            Err(AppError::Duplicate) => return Err(AppError::Conflict("That slot is already offered".into())),
            Err(e) => return Err(e),
        };
        record(&state, &tenant, who, "open_shift.create", &offer, None).await;

        if state.mailer.is_some() {
            let around = Surroundings::load(&state, &tenant.0, offer.date, offer.date).await?;
            let eligible: Vec<Uuid> = state
                .employee_repo
                .list_employees(&tenant.0, None, None)
                .await?
                .iter()
                .filter(|e| around.reasons(e, &offer).is_empty())
                .map(|e| e.id)
                .collect();
            let text = slot_text(&offer, &around.shifts);
            notifier::notify(
                &state,
                &tenant.0,
                notifier::EVENT_OPEN_SHIFT_OFFERED,
                &eligible,
                &format!("Open shift: {text}"),
                &format!("A shift is open and you may take it: {text}.\n\nVolunteer if you would like it; a planner decides."),
                Some("open-shifts"),
            )
            .await;
        }
        Ok(Json(serde_json::to_value(offer).unwrap()))
    }

    /// POST /open-shifts/:id/volunteer — the caller offers to take it.
    pub async fn volunteer(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        if roles.can_write() {
            return Err(AppError::Forbidden("Planners and admins assign open shifts; only employees volunteer".into()));
        }
        let me = caller_employee(&state, &tenant, &user)
            .await?
            .ok_or_else(|| AppError::Validation("No employee matches your account".into()))?;
        let offer = load(&state, &tenant, id).await?;
        if offer.status != open_shift_status::OPEN {
            return Err(AppError::Conflict(format!("This shift is already {}", offer.status)));
        }
        let around = Surroundings::load(&state, &tenant.0, offer.date, offer.date).await?;
        let reasons = around.reasons(&me, &offer);
        if !reasons.is_empty() {
            return Err(refusal("You cannot take this shift", &reasons));
        }
        state.open_shift_repo.add_volunteer(&tenant.0, id, me.id).await?;
        record(&state, &tenant, actor_name(&actor, &user), "open_shift.volunteer", &offer, Some(me.id)).await;
        Ok(Json(json!({ "message": "You volunteered", "open_shift_id": id })))
    }

    /// POST /open-shifts/:id/withdraw — the caller takes their offer back.
    pub async fn withdraw(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let me = caller_employee(&state, &tenant, &user)
            .await?
            .ok_or_else(|| AppError::Validation("No employee matches your account".into()))?;
        let offer = load(&state, &tenant, id).await?;
        if !state.open_shift_repo.remove_volunteer(&tenant.0, id, me.id).await? {
            return Err(AppError::NotFound);
        }
        record(&state, &tenant, actor_name(&actor, &user), "open_shift.withdraw", &offer, Some(me.id)).await;
        Ok(Json(json!({ "message": "You withdrew", "open_shift_id": id })))
    }

    /// POST /open-shifts/:id/assign — `{employee_id}`. A volunteer or anyone else
    /// who may take it; writes the shift into the roster.
    pub async fn assign(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        change: RosterChange,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<AssignOpenShift>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let offer = load(&state, &tenant, id).await?;
        if offer.status != open_shift_status::OPEN {
            return Err(AppError::Conflict(format!("This shift is already {}", offer.status)));
        }
        let person = state
            .employee_repo
            .get_employee(&tenant.0, body.employee_id)
            .await?
            .ok_or_else(|| AppError::Validation("No such employee".into()))?;
        let around = Surroundings::load(&state, &tenant.0, offer.date, offer.date).await?;
        let reasons = around.reasons(&person, &offer);
        if !reasons.is_empty() {
            return Err(refusal(&format!("{} cannot take this shift", person.name), &reasons));
        }

        let ctx = change.ctx(&state, &tenant.0, ChangeSource::Manual).await?;
        let who = actor_name(&actor, &user);
        let filled = state.open_shift_repo.fill_open_shift(&tenant.0, id, person.id, who.clone(), &ctx).await?;
        record(&state, &tenant, who, "open_shift.assign", &filled, Some(person.id)).await;

        let text = slot_text(&filled, &around.shifts);
        notifier::notify(
            &state,
            &tenant.0,
            notifier::EVENT_OPEN_SHIFT_OFFERED,
            &[person.id],
            &format!("You have the open shift: {text}"),
            &format!("You were assigned the open shift {text}."),
            Some("changes"),
        )
        .await;
        Ok(Json(serde_json::to_value(filled).unwrap()))
    }

    /// POST /open-shifts/:id/close — a planner withdraws the offer.
    pub async fn close(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        let offer = load(&state, &tenant, id).await?;
        let who = actor_name(&actor, &user);
        let closed = state
            .open_shift_repo
            .close_open_shift(&tenant.0, id, who.clone())
            .await?
            .ok_or_else(|| AppError::Conflict(format!("This shift is already {}", offer.status)))?;
        record(&state, &tenant, who, "open_shift.close", &closed, None).await;
        Ok(Json(serde_json::to_value(closed).unwrap()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveTime;

    fn d(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 12, day).unwrap()
    }

    fn time(h: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, 0, 0).unwrap()
    }

    fn shift(name: &str, start: u32, end: u32) -> Shift {
        Shift {
            id: Uuid::new_v4(),
            name: name.into(),
            short_name: name[..1].into(),
            color: "#000".into(),
            order: 1,
            break_minutes: 0,
            duty_type: "regular".into(),
            weekday_times: (0..7)
                .map(|weekday| crate::repository::domain::WeekdayTime {
                    weekday,
                    start_time: time(start),
                    end_time: time(end),
                    min_employees: 1,
                    max_employees: None,
                    free_days_after_shift: 0,
                })
                .collect(),
        }
    }

    fn capability(name: &str, level: i16, group: Option<&str>) -> Capability {
        Capability { id: Uuid::new_v4(), name: name.into(), level, skill_group: group.map(str::to_string), valid_until: None }
    }

    fn person(shifts: &[&Shift], caps: &[&Capability]) -> Employee {
        Employee {
            id: Uuid::new_v4(),
            name: "Anna".into(),
            email: "anna@test.invalid".into(),
            weekly_working_hours: Some(40.0),
            available_shifts: shifts.iter().map(|s| (*s).clone()).collect(),
            capabilities: caps.iter().map(|c| (*c).clone()).collect(),
        }
    }

    fn row(employee: &Employee, date: NaiveDate, shift: Option<&Shift>, absence: Option<&str>) -> ConfirmedShiftPlan {
        ConfirmedShiftPlan {
            id: Uuid::new_v4(),
            employee_id: employee.id,
            shift_id: shift.map(|s| s.id),
            workstation_id: None,
            date,
            is_present: shift.is_some(),
            absence_type: absence.map(str::to_string),
            creation_type: "manual".into(),
            created_at: Default::default(),
            updated_at: Default::default(),
        }
    }

    fn check(employee: &Employee, shift: &Shift, required: &[Capability], roster: &[ConfirmedShiftPlan], rest: f64) -> Vec<String> {
        let shifts = HashMap::from([(shift.id, shift.clone())]);
        ineligible_reasons(
            employee,
            &Facts { date: d(10), shift, required, shifts: &shifts, roster, unavailable: &[], min_rest_hours: rest },
        )
    }

    #[test]
    fn someone_qualified_and_free_may_take_it() {
        let early = shift("Early", 6, 14);
        let icu = capability("ICU", 1, None);
        let anna = person(&[&early], &[&icu]);
        assert!(check(&anna, &early, std::slice::from_ref(&icu), &[], 11.0).is_empty());
    }

    #[test]
    fn working_that_day_or_absent_rules_out() {
        let early = shift("Early", 6, 14);
        let anna = person(&[&early], &[]);
        let working = [row(&anna, d(10), Some(&early), None)];
        assert_eq!(check(&anna, &early, &[], &working, 0.0), vec!["Already working that day"]);
        let sick = [row(&anna, d(10), None, Some("sick"))];
        assert_eq!(check(&anna, &early, &[], &sick, 0.0), vec!["Absent that day (sick)"]);
    }

    #[test]
    fn a_planned_day_off_does_not_rule_out() {
        let early = shift("Early", 6, 14);
        let anna = person(&[&early], &[]);
        let free = [row(&anna, d(10), None, Some("free"))];
        assert!(check(&anna, &early, &[], &free, 0.0).is_empty());
    }

    #[test]
    fn a_shift_outside_their_availability_rules_out() {
        let early = shift("Early", 6, 14);
        let late = shift("Late", 14, 22);
        let anna = person(&[&late], &[]);
        assert_eq!(check(&anna, &early, &[], &[], 0.0), vec!["Not available for the Early shift"]);
    }

    #[test]
    fn a_missing_capability_is_named_and_a_higher_level_of_the_group_covers_it() {
        let early = shift("Early", 6, 14);
        let nurse_2 = capability("Nurse L2", 2, Some("nursing"));
        let nurse_3 = capability("Nurse L3", 3, Some("nursing"));
        let icu = capability("ICU", 1, None);
        let senior = person(&[&early], &[&nurse_3]);
        assert!(check(&senior, &early, std::slice::from_ref(&nurse_2), &[], 0.0).is_empty(), "L3 covers L2");
        let junior = person(&[&early], &[&nurse_2]);
        assert_eq!(check(&junior, &early, std::slice::from_ref(&nurse_3), &[], 0.0), vec!["Lacks Nurse L3"]);
        assert_eq!(check(&junior, &early, &[nurse_3.clone(), icu.clone()], &[], 0.0), vec!["Lacks Nurse L3, ICU"]);
    }

    #[test]
    fn too_little_rest_after_a_night_rules_out() {
        let night = shift("Night", 22, 6);
        let early = shift("Early", 6, 14);
        let anna = person(&[&early], &[]);
        // Night on the 9th ends at 06:00 on the 10th; an early shift starts then: no rest.
        let shifts = HashMap::from([(night.id, night.clone()), (early.id, early.clone())]);
        let roster = [row(&anna, d(9), Some(&night), None)];
        let reasons = ineligible_reasons(
            &anna,
            &Facts { date: d(10), shift: &early, required: &[], shifts: &shifts, roster: &roster, unavailable: &[], min_rest_hours: 11.0 },
        );
        assert_eq!(reasons, vec!["Only 0.0 h rest after the previous day's shift"]);
    }

    #[test]
    fn too_little_rest_before_the_next_day_rules_out() {
        let late = shift("Late", 14, 22);
        let early = shift("Early", 6, 14);
        let anna = person(&[&late], &[]);
        // Late on the 10th ends 22:00; early on the 11th starts 06:00: 8 h.
        let shifts = HashMap::from([(late.id, late.clone()), (early.id, early.clone())]);
        let roster = [row(&anna, d(11), Some(&early), None)];
        let reasons = ineligible_reasons(
            &anna,
            &Facts { date: d(10), shift: &late, required: &[], shifts: &shifts, roster: &roster, unavailable: &[], min_rest_hours: 11.0 },
        );
        assert_eq!(reasons, vec!["Only 8.0 h rest before the next day's shift"]);
    }

    #[test]
    fn rest_is_not_checked_when_the_rule_is_off() {
        let late = shift("Late", 14, 22);
        let early = shift("Early", 6, 14);
        let anna = person(&[&late], &[]);
        let shifts = HashMap::from([(late.id, late.clone()), (early.id, early.clone())]);
        let roster = [row(&anna, d(11), Some(&early), None)];
        let reasons = ineligible_reasons(
            &anna,
            &Facts { date: d(10), shift: &late, required: &[], shifts: &shifts, roster: &roster, unavailable: &[], min_rest_hours: 0.0 },
        );
        assert!(reasons.is_empty());
    }

    #[test]
    fn a_hard_unavailability_rules_out_but_a_soft_one_does_not() {
        let early = shift("Early", 6, 14);
        let anna = person(&[&early], &[]);
        let unavailable = |soft: bool| Unavailability {
            id: Uuid::new_v4(),
            employee_id: anna.id,
            unavailable_date: d(10),
            shift_id: None,
            is_soft_preference: soft,
        };
        let shifts = HashMap::from([(early.id, early.clone())]);
        let facts = |u: &[Unavailability]| {
            ineligible_reasons(
                &anna,
                &Facts { date: d(10), shift: &early, required: &[], shifts: &shifts, roster: &[], unavailable: u, min_rest_hours: 0.0 },
            )
        };
        assert_eq!(facts(&[unavailable(false)]), vec!["Marked unavailable that day"]);
        assert!(facts(&[unavailable(true)]).is_empty());
    }
}
