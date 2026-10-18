use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::domain::{
    EmployeeRepository, PersonalLimitsDomain, PersonalLimitsRepository, UpdatePersonalLimits,
};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::{RoleContext, TenantContext};

/// Per-employee limits the optimizer respects on top of the ward's rules: max
/// nights and weekends per month (hard or soft by the planner setting
/// `personal_limits_mode`), never nights (always hard), and weekdays they would
/// rather have off (soft).
pub struct PersonalLimitsService;

impl PersonalLimitsService {
    /// Every employee that has limits saved; employees without a row have none.
    pub async fn list_personal_limits(
        tenant: TenantContext,
        roles: RoleContext,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<PersonalLimitsDomain>>, AppError> {
        let rows = state.personal_limits_repo.list_personal_limits(&tenant.0).await?;
        Ok(Json(rows.into_iter().map(|l| visible_to(&roles, l)).collect()))
    }

    pub async fn get_personal_limits(
        tenant: TenantContext,
        roles: RoleContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<PersonalLimitsDomain>, AppError> {
        ensure_employee(&state, &tenant.0, employee_id).await?;
        let limits = state.personal_limits_repo.get_personal_limits(&tenant.0, employee_id).await?;
        Ok(Json(visible_to(&roles, limits)))
    }

    /// Replaces the employee's limits as a whole; an empty body clears them.
    pub async fn update_personal_limits(
        tenant: TenantContext,
        actor: AuditActor,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(mut body): Json<UpdatePersonalLimits>,
    ) -> Result<Json<PersonalLimitsDomain>, AppError> {
        ensure_employee(&state, &tenant.0, employee_id).await?;
        validate(&mut body)?;
        let before = state.personal_limits_repo.get_personal_limits(&tenant.0, employee_id).await?;
        let saved = state
            .personal_limits_repo
            .update_personal_limits(&tenant.0, employee_id, body)
            .await?;

        let changes = audit_changes(&before, &saved);
        audit_log::record(&state, &tenant.0, actor.0, "employee.personal_limits.update", "employee", Some(employee_id.to_string()), Some(changes)).await;

        Ok(Json(saved))
    }
}

/// Birth date and protection flag are shown to planners and admins only.
fn visible_to(roles: &RoleContext, limits: PersonalLimitsDomain) -> PersonalLimitsDomain {
    if roles.can_write() { limits } else { limits.redacted() }
}

/// The audit entry for a save: the limits without the sensitive fields, which
/// are noted as `changed` when they differ and otherwise left out.
fn audit_changes(before: &PersonalLimitsDomain, saved: &PersonalLimitsDomain) -> String {
    let mut value = serde_json::to_value(saved.clone().redacted()).unwrap_or_default();
    if let Some(map) = value.as_object_mut() {
        if before.date_of_birth != saved.date_of_birth {
            map.insert("date_of_birth".into(), "changed".into());
        }
        if before.maternity_protection != saved.maternity_protection {
            map.insert("maternity_protection".into(), "changed".into());
        }
    }
    value.to_string()
}

async fn ensure_employee(state: &AppState, tenant_id: &str, employee_id: Uuid) -> Result<(), AppError> {
    match state.employee_repo.get_employee(tenant_id, employee_id).await? {
        Some(_) => Ok(()),
        None => Err(AppError::NotFound),
    }
}

/// Bounds match the table's CHECK constraints; weekdays are sorted and
/// de-duplicated so the stored list is canonical.
fn validate(body: &mut UpdatePersonalLimits) -> Result<(), AppError> {
    if body.max_nights_per_month.is_some_and(|n| !(0..=31).contains(&n)) {
        return Err(AppError::Validation("max_nights_per_month must be between 0 and 31".into()));
    }
    if body.max_weekends_per_month.is_some_and(|n| !(0..=5).contains(&n)) {
        return Err(AppError::Validation("max_weekends_per_month must be between 0 and 5".into()));
    }
    if body.preferred_days_off.iter().any(|d| !(0..=6).contains(d)) {
        return Err(AppError::Validation(
            "preferred_days_off holds weekdays 0 (Monday) to 6 (Sunday)".into(),
        ));
    }
    if body.date_of_birth.is_some_and(|d| d > chrono::Utc::now().date_naive() || d.format("%Y").to_string().parse::<i32>().unwrap_or(0) < 1900) {
        return Err(AppError::Validation("date_of_birth must be a past date after 1900".into()));
    }
    body.preferred_days_off.sort_unstable();
    body.preferred_days_off.dedup();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(nights: Option<i16>, weekends: Option<i16>, days: &[i16]) -> UpdatePersonalLimits {
        UpdatePersonalLimits {
            max_nights_per_month: nights,
            max_weekends_per_month: weekends,
            no_night_shifts: false,
            preferred_days_off: days.to_vec(),
            date_of_birth: None,
            maternity_protection: false,
        }
    }

    #[test]
    fn limits_stay_within_a_month() {
        assert!(validate(&mut body(Some(0), Some(0), &[])).is_ok());
        assert!(validate(&mut body(Some(31), Some(5), &[])).is_ok());
        assert!(validate(&mut body(Some(32), None, &[])).is_err());
        assert!(validate(&mut body(None, Some(6), &[])).is_err());
        assert!(validate(&mut body(Some(-1), None, &[])).is_err());
    }

    #[test]
    fn weekdays_are_checked_sorted_and_deduplicated() {
        let mut b = body(None, None, &[6, 2, 6, 0]);
        validate(&mut b).unwrap();
        assert_eq!(b.preferred_days_off, vec![0, 2, 6]);
        assert!(validate(&mut body(None, None, &[7])).is_err());
    }
}
