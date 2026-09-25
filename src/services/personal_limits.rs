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
use crate::services::tenant::TenantContext;

/// Per-employee limits the optimizer respects on top of the ward's rules: max
/// nights and weekends per month (hard or soft by the planner setting
/// `personal_limits_mode`), never nights (always hard), and weekdays they would
/// rather have off (soft).
pub struct PersonalLimitsService;

impl PersonalLimitsService {
    /// Every employee that has limits saved; employees without a row have none.
    pub async fn list_personal_limits(
        tenant: TenantContext,
        State(state): State<AppState>,
    ) -> Result<Json<Vec<PersonalLimitsDomain>>, AppError> {
        Ok(Json(state.personal_limits_repo.list_personal_limits(&tenant.0).await?))
    }

    pub async fn get_personal_limits(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<PersonalLimitsDomain>, AppError> {
        ensure_employee(&state, &tenant.0, employee_id).await?;
        Ok(Json(state.personal_limits_repo.get_personal_limits(&tenant.0, employee_id).await?))
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
        let saved = state
            .personal_limits_repo
            .update_personal_limits(&tenant.0, employee_id, body)
            .await?;

        let changes = serde_json::to_string(&saved).unwrap_or_default();
        audit_log::record(&state, &tenant.0, actor.0, "employee.personal_limits.update", "employee", Some(employee_id.to_string()), Some(changes)).await;

        Ok(Json(saved))
    }
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
