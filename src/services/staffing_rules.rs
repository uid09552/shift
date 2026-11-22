//! The ward's skill-mix and pairing rules (`/skill-mix-rules`, `/pairing-rules`):
//! who has to — or may not — work alongside whom. Planners and admins keep them;
//! they reach the solver and the agent with every planning input (`TaskDTO`),
//! where `planner/shift_planner/skill_mix.py` says what each one means.
//!
//! Pairing rules say who works with whom, which is about people rather than the
//! ward, so neither list is shown to `shift-viewer`.

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{NewPairingRule, NewSkillMixRule, PairingRule, SkillMixRule};
use crate::models::{PairingRuleTask, SkillMixRuleTask};
use crate::repository::domain::{
    CapabilityRepository, EmployeeRepository, ShiftRepository, StaffingRuleRepository, WorkstationRepository,
};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::shift_swap::{actor_name, ensure_planner};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

/// No ward needs more on one shift; a larger number is a typo.
const MAX_COUNT: i32 = 50;

fn check_mode(mode: &str) -> Result<(), AppError> {
    match mode {
        "hard" | "soft" => Ok(()),
        other => Err(AppError::Validation(format!("mode must be hard or soft, not {other:?}"))),
    }
}

/// The rules as the solver reads them: capabilities by name, like employees' skills.
pub async fn rules_for_planning(
    state: &AppState,
    tenant_id: &str,
) -> Result<(Vec<SkillMixRuleTask>, Vec<PairingRuleTask>), AppError> {
    let mix = state.staffing_rule_repo.list_skill_mix_rules(tenant_id).await?;
    let pairs = state.staffing_rule_repo.list_pairing_rules(tenant_id).await?;
    if mix.is_empty() && pairs.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }
    let names: HashMap<Uuid, String> = state
        .capability_repo
        .list_capabilities(tenant_id)
        .await?
        .into_iter()
        .map(|c| (c.id, c.name))
        .collect();
    let mix = mix
        .into_iter()
        .map(|r| SkillMixRuleTask {
            id: r.id.to_string(),
            kind: r.kind,
            count: r.count,
            capability: r.capability_id.and_then(|c| names.get(&c).cloned()),
            skill_group: r.skill_group,
            min_level: r.min_level,
            shift_id: r.shift_id.map(|s| s.to_string()),
            workstation_id: r.workstation_id.map(|w| w.to_string()),
            mode: r.mode,
        })
        .collect();
    let pairs = pairs
        .into_iter()
        .map(|r| PairingRuleTask {
            id: r.id.to_string(),
            kind: r.kind,
            employee_id: r.employee_id.to_string(),
            partner_id: r.partner_id.to_string(),
            mode: r.mode,
        })
        .collect();
    Ok((mix, pairs))
}

pub struct StaffingRuleService;

impl StaffingRuleService {
    /// GET /skill-mix-rules
    pub async fn list_skill_mix_rules(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<SkillMixRule>>, AppError> {
        ensure_planner(&roles)?;
        Ok(Json(state.staffing_rule_repo.list_skill_mix_rules(&tenant.0).await?))
    }

    /// POST /skill-mix-rules — `{kind, count, capability_id? | skill_group + min_level,
    /// shift_id?, workstation_id?, mode}`.
    pub async fn create_skill_mix_rule(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(mut body): Json<NewSkillMixRule>,
    ) -> Result<Json<SkillMixRule>, AppError> {
        ensure_planner(&roles)?;
        body.tenant_id = tenant.0.clone();
        check_mode(&body.mode)?;
        if !matches!(body.kind.as_str(), "at_least" | "at_most") {
            return Err(AppError::Validation(format!("kind must be at_least or at_most, not {:?}", body.kind)));
        }
        if !(0..=MAX_COUNT).contains(&body.count) {
            return Err(AppError::Validation(format!("count must be between 0 and {MAX_COUNT}")));
        }
        body.skill_group = body.skill_group.map(|g| g.trim().to_string()).filter(|g| !g.is_empty());
        match body.capability_id {
            Some(id) => {
                state
                    .capability_repo
                    .get_capability(&tenant.0, id)
                    .await?
                    .ok_or_else(|| AppError::Validation("No such capability".into()))?;
                // One way of saying who counts, not two.
                body.skill_group = None;
                body.min_level = None;
            }
            None => {
                if body.kind == "at_most" {
                    return Err(AppError::Validation("An at-most rule counts the holders of one capability: name it".into()));
                }
                if body.skill_group.is_none() || body.min_level.is_none_or(|l| l < 1) {
                    return Err(AppError::Validation("Name a capability, or a skill group and a level of 1 or more".into()));
                }
            }
        }
        if let Some(shift_id) = body.shift_id {
            state.shift_repo.get_shift(&tenant.0, shift_id).await?.ok_or_else(|| AppError::Validation("No such shift".into()))?;
        }
        if let Some(workstation_id) = body.workstation_id {
            let ward = state
                .workstation_repo
                .get_workstation(&tenant.0, workstation_id)
                .await?
                .ok_or_else(|| AppError::Validation("No such workstation".into()))?;
            if let Some(shift_id) = body.shift_id {
                if !ward.active_shift_ids.contains(&shift_id) {
                    return Err(AppError::Validation(format!("{} does not run that shift", ward.name)));
                }
            }
        }
        let rule = state.staffing_rule_repo.create_skill_mix_rule(body).await?;
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "skill_mix_rule.create", "skill_mix_rule",
            Some(rule.id.to_string()), Some(serde_json::to_string(&rule).unwrap_or_default()),
        )
        .await;
        Ok(Json(rule))
    }

    /// DELETE /skill-mix-rules/:id
    pub async fn delete_skill_mix_rule(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        if !state.staffing_rule_repo.delete_skill_mix_rule(&tenant.0, id).await? {
            return Err(AppError::NotFound);
        }
        audit_log::record(&state, &tenant.0, actor_name(&actor, &user), "skill_mix_rule.delete", "skill_mix_rule", Some(id.to_string()), None).await;
        Ok(Json(json!({ "message": "Rule deleted" })))
    }

    /// GET /pairing-rules
    pub async fn list_pairing_rules(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<PairingRule>>, AppError> {
        ensure_planner(&roles)?;
        Ok(Json(state.staffing_rule_repo.list_pairing_rules(&tenant.0).await?))
    }

    /// POST /pairing-rules — `{kind: mentor|together|apart, employee_id, partner_id, mode}`.
    /// For a mentor rule `employee_id` is the trainee and `partner_id` the mentor.
    pub async fn create_pairing_rule(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(mut body): Json<NewPairingRule>,
    ) -> Result<Json<PairingRule>, AppError> {
        ensure_planner(&roles)?;
        body.tenant_id = tenant.0.clone();
        check_mode(&body.mode)?;
        if !matches!(body.kind.as_str(), "mentor" | "together" | "apart") {
            return Err(AppError::Validation(format!("kind must be mentor, together or apart, not {:?}", body.kind)));
        }
        if body.employee_id == body.partner_id {
            return Err(AppError::Validation("Pick two different people".into()));
        }
        for id in [body.employee_id, body.partner_id] {
            state.employee_repo.get_employee(&tenant.0, id).await?.ok_or_else(|| AppError::Validation("No such employee".into()))?;
        }
        // together and apart do not care about the order; mentor does.
        let same = |r: &PairingRule| {
            r.kind == body.kind
                && ((r.employee_id == body.employee_id && r.partner_id == body.partner_id)
                    || (body.kind != "mentor" && r.employee_id == body.partner_id && r.partner_id == body.employee_id))
        };
        let existing = state.staffing_rule_repo.list_pairing_rules(&tenant.0).await?;
        if existing.iter().any(same) {
            return Err(AppError::Conflict("That rule exists already".into()));
        }
        let clash = existing.iter().any(|r| {
            let pair = |a: Uuid, b: Uuid| (a == body.employee_id && b == body.partner_id) || (a == body.partner_id && b == body.employee_id);
            pair(r.employee_id, r.partner_id)
                && ((r.kind == "apart" && body.kind != "apart") || (r.kind != "apart" && body.kind == "apart"))
        });
        if clash {
            return Err(AppError::Conflict("These two are already kept apart — or together; remove that rule first".into()));
        }
        let rule = state.staffing_rule_repo.create_pairing_rule(body).await?;
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "pairing_rule.create", "pairing_rule",
            Some(rule.id.to_string()), Some(serde_json::to_string(&rule).unwrap_or_default()),
        )
        .await;
        Ok(Json(rule))
    }

    /// DELETE /pairing-rules/:id
    pub async fn delete_pairing_rule(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles)?;
        if !state.staffing_rule_repo.delete_pairing_rule(&tenant.0, id).await? {
            return Err(AppError::NotFound);
        }
        audit_log::record(&state, &tenant.0, actor_name(&actor, &user), "pairing_rule.delete", "pairing_rule", Some(id.to_string()), None).await;
        Ok(Json(json!({ "message": "Rule deleted" })))
    }
}
