//! What-if scenarios: the real planning input with overrides — a sick wave,
//! a closed ward, hypothetical hires, a different minimum — solved like any
//! run but stored apart. A scenario's result (`source: scenario`) is never the
//! latest proposal, never listed with the real ones and never taken as the
//! roster; it can be compared with them on the scheduler's Compare tab.
//! Promoting one means planning the period again with the real data.

use std::collections::HashMap;

use axum::{extract::State, Json};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{EmployeeTask, FairnessBalanceTask, TaskDTO, WorkstationUnavailabilityRange};
use crate::repository::domain::CapabilityRepository;
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::optimizer::{build_constraints, OptimizerService};
use crate::services::shift_swap::{actor_name, ensure_planner};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Absence {
    pub employee_id: Uuid,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Closure {
    pub workstation_id: Uuid,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Hire {
    pub name: String,
    #[serde(default)]
    pub capability_ids: Vec<Uuid>,
    #[serde(default)]
    pub shift_ids: Vec<Uuid>,
    #[serde(default)]
    pub weekly_working_hours: Option<f64>,
    /// How many people like this (1 unless given).
    #[serde(default)]
    pub count: Option<u8>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct MinStaffing {
    pub workstation_id: Uuid,
    pub min_employees: i16,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Overrides {
    #[serde(default)]
    pub absences: Vec<Absence>,
    #[serde(default)]
    pub closed_workstations: Vec<Closure>,
    #[serde(default)]
    pub extra_employees: Vec<Hire>,
    #[serde(default)]
    pub min_staffing: Vec<MinStaffing>,
}

#[derive(Deserialize)]
pub struct ScenarioRequest {
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    #[serde(default)]
    pub employee_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    pub overrides: Overrides,
}

/// The default weekly hours of a hypothetical hire.
const DEFAULT_HIRE_HOURS: f64 = 40.0;
const MAX_HIRES: usize = 50;

/// Applies the overrides to a planning input. `capability_names` maps ids to
/// the names the solver matches skills by.
pub fn apply(dto: &mut TaskDTO, overrides: &Overrides, capability_names: &HashMap<Uuid, String>) -> Result<(), AppError> {
    let period_start = NaiveDate::parse_from_str(&dto.planning_period.start_date, "%Y-%m-%d").map_err(|_| AppError::Internal)?;
    let period_end = NaiveDate::parse_from_str(&dto.planning_period.end_date, "%Y-%m-%d").map_err(|_| AppError::Internal)?;

    for a in &overrides.absences {
        if a.to_date < a.from_date {
            return Err(AppError::Validation("An absence ends before it starts".into()));
        }
        let id = a.employee_id.to_string();
        let employee = dto
            .employees
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| AppError::Validation(format!("Employee {id} is not in this plan")))?;
        let mut day = a.from_date.max(period_start);
        while day <= a.to_date.min(period_end) {
            employee.unavailability.push(day.to_string());
            day = day.succ_opt().ok_or(AppError::Internal)?;
        }
        employee.unavailability.sort();
        employee.unavailability.dedup();
    }

    for c in &overrides.closed_workstations {
        if c.to_date < c.from_date {
            return Err(AppError::Validation("A closure ends before it starts".into()));
        }
        let id = c.workstation_id.to_string();
        let ws = dto
            .workstations
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or_else(|| AppError::Validation(format!("Workstation {id} is not in this plan")))?;
        ws.unavailability.push(WorkstationUnavailabilityRange {
            from_date: c.from_date.to_string(),
            to_date: c.to_date.to_string(),
        });
    }

    for m in &overrides.min_staffing {
        if !(0..=99).contains(&m.min_employees) {
            return Err(AppError::Validation("min_employees must be between 0 and 99".into()));
        }
        let id = m.workstation_id.to_string();
        let ws = dto
            .workstations
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or_else(|| AppError::Validation(format!("Workstation {id} is not in this plan")))?;
        ws.min_employees = m.min_employees;
        // A changed minimum is the point of the scenario: it replaces any
        // demand curve, so the number asked for is the number planned for.
        ws.demand.clear();
    }

    let hires: usize = overrides.extra_employees.iter().map(|h| h.count.unwrap_or(1).max(1) as usize).sum();
    if hires > MAX_HIRES {
        return Err(AppError::Validation(format!("At most {MAX_HIRES} hypothetical employees")));
    }
    // A hire starts with the team's average balance, so the long-term duty
    // balance neither loads every night on them nor spares them.
    let balances: Vec<&FairnessBalanceTask> = dto.employees.iter().filter_map(|e| e.fairness_balance.as_ref()).collect();
    let average = (!balances.is_empty()).then(|| {
        let n = balances.len() as i64;
        FairnessBalanceTask {
            nights: balances.iter().map(|b| b.nights).sum::<i64>() / n,
            weekend_days: balances.iter().map(|b| b.weekend_days).sum::<i64>() / n,
            holiday_shifts: balances.iter().map(|b| b.holiday_shifts).sum::<i64>() / n,
            on_call: balances.iter().map(|b| b.on_call).sum::<i64>() / n,
        }
    });
    let mut number = 0;
    for hire in &overrides.extra_employees {
        let name = hire.name.trim();
        if name.is_empty() {
            return Err(AppError::Validation("A hypothetical employee needs a name".into()));
        }
        let skills = hire
            .capability_ids
            .iter()
            .map(|id| capability_names.get(id).cloned().ok_or_else(|| AppError::Validation(format!("Unknown capability {id}"))))
            .collect::<Result<Vec<_>, _>>()?;
        let hours = hire.weekly_working_hours.unwrap_or(DEFAULT_HIRE_HOURS);
        if !(0.0..=80.0).contains(&hours) {
            return Err(AppError::Validation("weekly_working_hours must be between 0 and 80".into()));
        }
        let count = hire.count.unwrap_or(1).max(1);
        for i in 0..count {
            number += 1;
            let label = if count > 1 { format!("{name} {} (hypothetical)", i + 1) } else { format!("{name} (hypothetical)") };
            let mut employee: EmployeeTask = serde_json::from_value(json!({
                "id": format!("scenario-hire-{number}"),
                "name": label,
                "skills": skills,
                "available_shifts": hire.shift_ids.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                "unavailability": [],
                "weekly_working_hours": hours,
            }))
            .map_err(|_| AppError::Internal)?;
            employee.fairness_balance = average.clone();
            dto.employees.push(employee);
        }
    }
    Ok(())
}

pub struct ScenarioService;

impl ScenarioService {
    /// POST /planner/scenarios — solve a what-if scenario; poll its task as any
    /// other run. The result is stored apart (`source: scenario`).
    pub async fn create(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(request): Json<ScenarioRequest>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles).map_err(|_| AppError::Forbidden("Only a planner or an admin runs scenarios".into()))?;
        let name = request.name.trim().to_string();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::Validation("A scenario needs a name of at most 80 characters".into()));
        }
        if state.nats_client.is_none() {
            return Err(AppError::Unavailable("The planner queue is not available".into()));
        }
        let constraints = Some(build_constraints(&state, &tenant.0, None).await);
        let mut dto = OptimizerService::build_task_dto(
            &state,
            &tenant.0,
            request.employee_ids.as_deref(),
            Some(&request.start_date),
            Some(&request.end_date),
            constraints,
        )
        .await
        .map_err(|e| AppError::Validation(e.to_string()))?;
        let capability_names: HashMap<Uuid, String> =
            state.capability_repo.list_capabilities(&tenant.0).await?.into_iter().map(|c| (c.id, c.name)).collect();
        apply(&mut dto, &request.overrides, &capability_names)?;

        let task_id = Uuid::new_v4();
        let scenario = json!({"name": name, "overrides": request.overrides});
        OptimizerService::new(state.clone())
            .publish(&tenant.0, task_id, &dto, "scenario", Some(scenario.clone()))
            .await
            .map_err(|e| AppError::Validation(e.to_string()))?;
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "planner.scenario", "planning_task", Some(task_id.to_string()),
            Some(scenario.to_string()),
        )
        .await;
        Ok(Json(json!({"task_id": task_id})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dto() -> TaskDTO {
        serde_json::from_value(json!({
            "planning_period": {"start_date": "2026-09-01", "end_date": "2026-09-30"},
            "shifts": [],
            "workstations": [{
                "id": "00000000-0000-0000-0000-0000000000b1", "name": "ICU", "required_skills": [], "priority": "high",
                "operating_shifts": [], "min_employees": 1, "max_employees": null,
                "demand": [{"weekday": "0", "hours": vec![1i16; 24]}],
            }],
            "employees": [{
                "id": "00000000-0000-0000-0000-0000000000a1", "name": "Anna", "skills": [], "available_shifts": [],
                "unavailability": ["2026-09-02"], "weekly_working_hours": 40.0,
                "fairness_balance": {"nights": 10, "weekend_days": 4, "holiday_shifts": 0, "on_call": 2},
            }],
            "capabilities": [],
            "history": [], "holidays": [], "published_roster": [], "skill_mix_rules": [], "pairing_rules": [],
            "constraints": null,
        }))
        .unwrap()
    }

    fn id(s: &str) -> Uuid {
        s.parse().unwrap()
    }

    #[test]
    fn absences_closures_and_minimums_change_the_input_only() {
        let mut input = dto();
        let overrides = Overrides {
            absences: vec![Absence { employee_id: id("00000000-0000-0000-0000-0000000000a1"), from_date: "2026-08-30".parse().unwrap(), to_date: "2026-09-03".parse().unwrap() }],
            closed_workstations: vec![Closure { workstation_id: id("00000000-0000-0000-0000-0000000000b1"), from_date: "2026-09-10".parse().unwrap(), to_date: "2026-09-12".parse().unwrap() }],
            min_staffing: vec![MinStaffing { workstation_id: id("00000000-0000-0000-0000-0000000000b1"), min_employees: 3 }],
            ..Default::default()
        };
        apply(&mut input, &overrides, &HashMap::new()).unwrap();
        assert_eq!(input.employees[0].unavailability, vec!["2026-09-01", "2026-09-02", "2026-09-03"], "clipped to the period, no duplicates");
        assert_eq!(input.workstations[0].unavailability[0].from_date, "2026-09-10");
        assert_eq!(input.workstations[0].min_employees, 3);
        assert!(input.workstations[0].demand.is_empty(), "a changed minimum replaces the curve");
    }

    #[test]
    fn hypothetical_hires_get_capability_names_and_the_average_balance() {
        let mut input = dto();
        let care = Uuid::new_v4();
        let names: HashMap<Uuid, String> = [(care, "Intensive care".to_string())].into_iter().collect();
        let overrides = Overrides {
            extra_employees: vec![Hire { name: "New nurse".into(), capability_ids: vec![care], count: Some(2), ..Default::default() }],
            ..Default::default()
        };
        apply(&mut input, &overrides, &names).unwrap();
        assert_eq!(input.employees.len(), 3);
        let hire = &input.employees[2];
        assert_eq!(hire.name, "New nurse 2 (hypothetical)");
        assert_eq!(hire.skills, vec!["Intensive care"]);
        assert_eq!(hire.weekly_working_hours, 40.0);
        assert_eq!(hire.fairness_balance.as_ref().unwrap().nights, 10);
        assert_ne!(input.employees[1].id, hire.id);
    }

    #[test]
    fn unknown_people_places_and_skills_are_refused() {
        let unknown = Overrides {
            absences: vec![Absence { employee_id: Uuid::new_v4(), from_date: "2026-09-01".parse().unwrap(), to_date: "2026-09-01".parse().unwrap() }],
            ..Default::default()
        };
        assert!(apply(&mut dto(), &unknown, &HashMap::new()).is_err());
        let skill = Overrides { extra_employees: vec![Hire { name: "X".into(), capability_ids: vec![Uuid::new_v4()], ..Default::default() }], ..Default::default() };
        assert!(apply(&mut dto(), &skill, &HashMap::new()).is_err());
        let many = Overrides { extra_employees: vec![Hire { name: "X".into(), count: Some(51), ..Default::default() }], ..Default::default() };
        assert!(apply(&mut dto(), &many, &HashMap::new()).is_err());
    }
}
