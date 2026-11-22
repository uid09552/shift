//! Recurring availability per employee: "only early shifts", "never on
//! Wednesdays", "part-time on Mon/Tue/Thu" — each hard or soft, optionally for
//! a date range (`/employees/{id}/availability-rules`).
//!
//! Nothing downstream has to learn a new rule: `expand` turns them, over a
//! planning period, into what the solver and the agent already read — hard
//! weekday rules into whole-day `unavailability`, hard shift rules into
//! `blocked_shifts`, soft ones into `preferred_off` (with or without a shift).
//! Open shifts ask `hard_block` directly.
//!
//! Planners and admins keep the rules; an employee may read their own.

use std::collections::BTreeSet;

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{Datelike, NaiveDate};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{AvailabilityRule, NewAvailabilityRule};
use crate::repository::domain::{AvailabilityRuleRepository, EmployeeRepository, ShiftRepository};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::shift_swap::{actor_name, caller_employee};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

pub const KINDS: [&str; 4] = ["only_shifts", "not_shifts", "only_weekdays", "not_weekdays"];

/// 0 = Monday … 6 = Sunday, as everywhere else in the backend.
fn weekday(day: NaiveDate) -> i16 {
    day.weekday().num_days_from_monday() as i16
}

fn active_on(rule: &AvailabilityRule, day: NaiveDate) -> bool {
    rule.valid_from.is_none_or(|from| day >= from) && rule.valid_until.is_none_or(|until| day <= until)
}

/// Whether `rule` rules out the whole of `day`.
fn day_ruled_out(rule: &AvailabilityRule, day: NaiveDate) -> bool {
    match rule.kind.as_str() {
        "not_weekdays" => rule.weekdays.contains(&weekday(day)),
        "only_weekdays" => !rule.weekdays.contains(&weekday(day)),
        _ => false,
    }
}

/// Whether `rule` rules out `shift_id` (on a day it is active).
fn shift_ruled_out(rule: &AvailabilityRule, shift_id: Uuid) -> bool {
    match rule.kind.as_str() {
        "not_shifts" => rule.shift_ids.contains(&shift_id),
        "only_shifts" => !rule.shift_ids.contains(&shift_id),
        _ => false,
    }
}

/// One employee's rules over `from`…`to`, in the solver's terms.
#[derive(Debug, Default, PartialEq)]
pub struct Expansion {
    /// Hard: away all day.
    pub unavailable: BTreeSet<NaiveDate>,
    /// Hard: may not work this shift that day.
    pub blocked: BTreeSet<(NaiveDate, Uuid)>,
    /// Soft: would rather not — the whole day (`None`) or one shift.
    pub preferred_off: BTreeSet<(NaiveDate, Option<Uuid>)>,
}

pub fn expand(rules: &[AvailabilityRule], shifts: &[Uuid], from: NaiveDate, to: NaiveDate) -> Expansion {
    let mut out = Expansion::default();
    let mut day = from;
    while day <= to {
        for rule in rules.iter().filter(|r| active_on(r, day)) {
            let hard = rule.mode == "hard";
            if day_ruled_out(rule, day) {
                if hard {
                    out.unavailable.insert(day);
                } else {
                    out.preferred_off.insert((day, None));
                }
            }
            for shift in shifts.iter().filter(|s| shift_ruled_out(rule, **s)) {
                if hard {
                    out.blocked.insert((day, *shift));
                } else {
                    out.preferred_off.insert((day, Some(*shift)));
                }
            }
        }
        day = day.succ_opt().expect("date in range");
    }
    // A day off already covers its shifts.
    let whole_days = out.unavailable.clone();
    out.blocked.retain(|(d, _)| !whole_days.contains(d));
    out
}

/// The hard rule that keeps the employee off `shift_id` on `day`, if any.
pub fn hard_block(rules: &[AvailabilityRule], day: NaiveDate, shift_id: Uuid) -> Option<&AvailabilityRule> {
    rules
        .iter()
        .filter(|r| r.mode == "hard" && active_on(r, day))
        .find(|r| day_ruled_out(r, day) || shift_ruled_out(r, shift_id))
}

pub struct AvailabilityService;

impl AvailabilityService {
    /// GET /employees/:id/availability-rules — planners any, an employee their own.
    pub async fn list_for_employee(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<AvailabilityRule>>, AppError> {
        if !roles.can_write() {
            let me = caller_employee(&state, &tenant, &user).await?;
            if me.is_none_or(|me| me.id != employee_id) {
                return Err(AppError::Forbidden("You may only read your own availability".into()));
            }
        }
        Ok(Json(state.staffing_rule_repo.list_availability_rules(&tenant.0, Some(employee_id)).await?))
    }

    /// GET /availability-rules — everyone's. Planners and admins only.
    pub async fn list_all(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<AvailabilityRule>>, AppError> {
        crate::services::shift_swap::ensure_planner(&roles)?;
        Ok(Json(state.staffing_rule_repo.list_availability_rules(&tenant.0, None).await?))
    }

    /// POST /employees/:id/availability-rules — `{kind, shift_ids | weekdays, mode, valid_from?, valid_until?, note?}`.
    pub async fn create(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(mut body): Json<NewAvailabilityRule>,
    ) -> Result<Json<AvailabilityRule>, AppError> {
        state.employee_repo.get_employee(&tenant.0, employee_id).await?.ok_or(AppError::NotFound)?;
        body.tenant_id = tenant.0.clone();
        body.employee_id = employee_id;
        if !KINDS.contains(&body.kind.as_str()) {
            return Err(AppError::Validation(format!("kind must be one of {}", KINDS.join(", "))));
        }
        if !matches!(body.mode.as_str(), "hard" | "soft") {
            return Err(AppError::Validation("mode must be hard or soft".into()));
        }
        if let (Some(from), Some(until)) = (body.valid_from, body.valid_until) {
            if until < from {
                return Err(AppError::Validation("The end date is before the start date".into()));
            }
        }
        body.note = body.note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if body.kind.ends_with("_shifts") {
            body.weekdays.clear();
            body.shift_ids.sort();
            body.shift_ids.dedup();
            if body.shift_ids.is_empty() {
                return Err(AppError::Validation("Pick at least one shift".into()));
            }
            let known: Vec<Uuid> = state.shift_repo.list_shifts(&tenant.0).await?.into_iter().map(|s| s.id).collect();
            if body.shift_ids.iter().any(|s| !known.contains(s)) {
                return Err(AppError::Validation("No such shift".into()));
            }
        } else {
            body.shift_ids.clear();
            body.weekdays.sort();
            body.weekdays.dedup();
            if body.weekdays.is_empty() || body.weekdays.iter().any(|d| !(0..=6).contains(d)) {
                return Err(AppError::Validation("Pick weekdays from 0 (Monday) to 6 (Sunday)".into()));
            }
            if body.kind == "not_weekdays" && body.weekdays.len() == 7 {
                return Err(AppError::Validation("That would rule out every day".into()));
            }
        }
        let rule = state.staffing_rule_repo.create_availability_rule(body).await?;
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "availability_rule.create", "employee",
            Some(employee_id.to_string()), Some(serde_json::to_string(&rule).unwrap_or_default()),
        )
        .await;
        Ok(Json(rule))
    }

    /// DELETE /employees/:id/availability-rules/:rule_id
    pub async fn delete(
        tenant: TenantContext,
        user: UserContext,
        actor: AuditActor,
        Path((employee_id, rule_id)): Path<(Uuid, Uuid)>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        if !state.staffing_rule_repo.delete_availability_rule(&tenant.0, employee_id, rule_id).await? {
            return Err(AppError::NotFound);
        }
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "availability_rule.delete", "employee",
            Some(employee_id.to_string()), Some(json!({ "rule_id": rule_id }).to_string()),
        )
        .await;
        Ok(Json(json!({ "message": "Rule deleted" })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(day: u32) -> NaiveDate {
        // December 2026: the 7th is a Monday.
        NaiveDate::from_ymd_opt(2026, 12, day).unwrap()
    }

    fn rule(kind: &str, mode: &str, shifts: &[Uuid], weekdays: &[i16]) -> AvailabilityRule {
        AvailabilityRule {
            id: Uuid::new_v4(),
            tenant_id: "t".into(),
            employee_id: Uuid::new_v4(),
            kind: kind.into(),
            shift_ids: shifts.to_vec(),
            weekdays: weekdays.to_vec(),
            mode: mode.into(),
            valid_from: None,
            valid_until: None,
            note: None,
            created_at: Default::default(),
        }
    }

    #[test]
    fn never_on_wednesdays_is_a_whole_day_off_each_wednesday() {
        let out = expand(&[rule("not_weekdays", "hard", &[], &[2])], &[], d(7), d(20));
        assert_eq!(out.unavailable.into_iter().collect::<Vec<_>>(), vec![d(9), d(16)]);
    }

    #[test]
    fn part_time_on_fixed_days_takes_the_other_days_out() {
        let out = expand(&[rule("only_weekdays", "hard", &[], &[0, 1, 3])], &[], d(7), d(13));
        assert_eq!(out.unavailable.into_iter().collect::<Vec<_>>(), vec![d(9), d(11), d(12), d(13)]);
    }

    #[test]
    fn only_early_shifts_blocks_every_other_shift() {
        let (early, late, night) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let out = expand(&[rule("only_shifts", "hard", &[early], &[])], &[early, late, night], d(7), d(7));
        assert_eq!(out.blocked, BTreeSet::from([(d(7), late), (d(7), night)]));
        assert!(out.unavailable.is_empty());
    }

    #[test]
    fn a_soft_rule_is_a_preference_only() {
        let night = Uuid::new_v4();
        let out = expand(
            &[rule("not_shifts", "soft", &[night], &[]), rule("not_weekdays", "soft", &[], &[0])],
            &[night],
            d(7),
            d(8),
        );
        assert!(out.unavailable.is_empty() && out.blocked.is_empty());
        assert_eq!(
            out.preferred_off,
            BTreeSet::from([(d(7), None), (d(7), Some(night)), (d(8), Some(night))])
        );
    }

    #[test]
    fn a_rule_only_counts_inside_its_dates() {
        let mut r = rule("not_weekdays", "hard", &[], &[0, 1, 2, 3, 4]);
        r.valid_from = Some(d(14));
        r.valid_until = Some(d(15));
        let out = expand(&[r], &[], d(7), d(20));
        assert_eq!(out.unavailable.into_iter().collect::<Vec<_>>(), vec![d(14), d(15)]);
    }

    #[test]
    fn a_whole_day_off_needs_no_blocked_shifts_on_top() {
        let early = Uuid::new_v4();
        let out = expand(
            &[rule("not_weekdays", "hard", &[], &[0]), rule("not_shifts", "hard", &[early], &[])],
            &[early],
            d(7),
            d(8),
        );
        assert_eq!(out.unavailable, BTreeSet::from([d(7)]));
        assert_eq!(out.blocked, BTreeSet::from([(d(8), early)]));
    }

    #[test]
    fn the_hard_block_for_one_slot() {
        let (early, late) = (Uuid::new_v4(), Uuid::new_v4());
        let rules = [rule("not_shifts", "hard", &[late], &[]), rule("not_weekdays", "soft", &[], &[0])];
        assert!(hard_block(&rules, d(7), early).is_none(), "a soft rule never blocks");
        assert_eq!(hard_block(&rules, d(7), late).map(|r| r.kind.as_str()), Some("not_shifts"));
    }
}
