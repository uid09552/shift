use axum::{
    extract::{Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::Value;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::{AnalysisRepository, RosterFactsDomain};
use crate::services::tenant::{RoleContext, TenantContext};

#[derive(Deserialize)]
pub struct AnalysisQuery {
    pub from_date: String,
    pub to_date: String,
}

/// Longest period the fairness report and the analytics facts cover.
pub(crate) const MAX_PERIOD_DAYS: i64 = 366;

/// The inclusive period of an analysis query, refused when it is malformed,
/// reversed or longer than `max_days`.
pub(crate) fn parse_period(q: &AnalysisQuery, max_days: i64) -> Result<(NaiveDate, NaiveDate), AppError> {
    let from_date = NaiveDate::parse_from_str(&q.from_date, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
    let to_date = NaiveDate::parse_from_str(&q.to_date, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;
    if from_date > to_date {
        return Err(AppError::Validation("from_date must be before or equal to to_date".into()));
    }
    if (to_date - from_date).num_days() > max_days {
        return Err(AppError::Validation("The period may cover at most one year".into()));
    }
    Ok((from_date, to_date))
}

pub struct AnalysisService;

impl AnalysisService {
    /// GET /analysis/planned-hours-per-day-per-workstation
    /// Returns the planned hours per day per workstation based on confirmed shift plans.
    /// Requires from_date and to_date query parameters (YYYY-MM-DD format).
    pub async fn get_planned_hours_per_day_per_workstation(
        tenant: TenantContext,
        Query(q): Query<AnalysisQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let from_date = NaiveDate::parse_from_str(&q.from_date, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
        let to_date = NaiveDate::parse_from_str(&q.to_date, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;

        if from_date > to_date {
            return Err(AppError::Validation("from_date must be before or equal to to_date".into()));
        }

        let results = state
            .analysis_repo
            .get_planned_hours_per_day_per_workstation(&tenant.0, from_date, to_date)
            .await?;

        Ok(Json(serde_json::to_value(results).unwrap()))
    }

    /// GET /analysis/planned-employees-per-day-per-workstation
    /// Returns the number of planned employees per day per workstation based on confirmed shift plans.
    /// Requires from_date and to_date query parameters (YYYY-MM-DD format).
    pub async fn get_planned_employees_per_day_per_workstation(
        tenant: TenantContext,
        Query(q): Query<AnalysisQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let from_date = NaiveDate::parse_from_str(&q.from_date, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
        let to_date = NaiveDate::parse_from_str(&q.to_date, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;

        if from_date > to_date {
            return Err(AppError::Validation("from_date must be before or equal to to_date".into()));
        }

        let results = state
            .analysis_repo
            .get_planned_employees_per_day_per_workstation(&tenant.0, from_date, to_date)
            .await?;

        Ok(Json(serde_json::to_value(results).unwrap()))
    }

    /// GET /analysis/staffing-per-day
    /// Returns, per day, how many distinct employees are working and how they
    /// split across shifts — the answer to "how many people work today".
    /// Requires from_date and to_date query parameters (YYYY-MM-DD format).
    pub async fn get_staffing_per_day(
        tenant: TenantContext,
        Query(q): Query<AnalysisQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let from_date = NaiveDate::parse_from_str(&q.from_date, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
        let to_date = NaiveDate::parse_from_str(&q.to_date, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;

        if from_date > to_date {
            return Err(AppError::Validation("from_date must be before or equal to to_date".into()));
        }

        let results = state
            .analysis_repo
            .get_staffing_per_day(&tenant.0, from_date, to_date)
            .await?;

        Ok(Json(serde_json::to_value(results).unwrap()))
    }

    /// GET /analysis/fairness
    /// Per employee, over the period: shifts, hours against target, nights,
    /// weekends, wishes granted of asked, days absent — from confirmed plans.
    /// Requires from_date and to_date query parameters (YYYY-MM-DD format).
    pub async fn get_fairness(
        tenant: TenantContext,
        Query(q): Query<AnalysisQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        // A year is plenty for "this quarter" questions and keeps the load bounded.
        let (from_date, to_date) = parse_period(&q, MAX_PERIOD_DAYS)?;

        let employees = state
            .analysis_repo
            .get_fairness(&tenant.0, from_date, to_date)
            .await?;

        Ok(Json(serde_json::json!({
            "from_date": from_date,
            "to_date": to_date,
            "days": (to_date - from_date).num_days() + 1,
            "employees": employees,
        })))
    }

    /// GET /analysis/roster-facts
    /// The confirmed roster of a period as columns, with the employees,
    /// capabilities, shifts (and their weekday staffing bounds), workstations
    /// (and closures), month statuses and holidays needed to read them — the
    /// Analytics page aggregates in the browser. Planners and admins only.
    pub async fn get_roster_facts(
        tenant: TenantContext,
        roles: RoleContext,
        Query(q): Query<AnalysisQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<RosterFactsDomain>, AppError> {
        require_analyst(&roles)?;
        let (from_date, to_date) = parse_period(&q, MAX_PERIOD_DAYS)?;
        let facts = state.analysis_repo.get_roster_facts(&tenant.0, from_date, to_date).await?;
        Ok(Json(facts))
    }

    /// GET /analysis/change-facts
    /// Every roster change notice created in the period: who and which day,
    /// workstation and shift before and after, source, actor, reason and when
    /// it was acknowledged. Planners and admins only.
    pub async fn get_change_facts(
        tenant: TenantContext,
        roles: RoleContext,
        Query(q): Query<AnalysisQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        require_analyst(&roles)?;
        let (from_date, to_date) = parse_period(&q, MAX_PERIOD_DAYS)?;
        let notices = state.analysis_repo.get_change_facts(&tenant.0, from_date, to_date).await?;
        Ok(Json(serde_json::json!({
            "from_date": from_date,
            "to_date": to_date,
            "notices": notices,
        })))
    }

    /// GET /analysis/audit-activity
    /// Audit entries of the period counted per day, action, item type and
    /// actor, plus the total. The entries themselves stay on `/audit-logs`,
    /// which the page opens filtered to a group. Planners and admins only.
    pub async fn get_audit_activity(
        tenant: TenantContext,
        roles: RoleContext,
        Query(q): Query<AnalysisQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        require_analyst(&roles)?;
        let (from_date, to_date) = parse_period(&q, MAX_PERIOD_DAYS)?;
        let groups = state.analysis_repo.get_audit_activity(&tenant.0, from_date, to_date).await?;
        let total: i64 = groups.iter().map(|g| g.count).sum();
        Ok(Json(serde_json::json!({
            "from_date": from_date,
            "to_date": to_date,
            "total": total,
            "groups": groups,
        })))
    }

    /// GET /analysis/planning-runs
    /// Every planning task created in the period: source, status, timing, the
    /// solver's verdict and — for automatic runs — whether the plan became the
    /// roster. Never the plan itself. Planners and admins only.
    pub async fn get_planning_runs(
        tenant: TenantContext,
        roles: RoleContext,
        Query(q): Query<AnalysisQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        require_analyst(&roles)?;
        let (from_date, to_date) = parse_period(&q, MAX_PERIOD_DAYS)?;
        let runs = state.analysis_repo.get_planning_runs(&tenant.0, from_date, to_date).await?;
        Ok(Json(serde_json::json!({
            "from_date": from_date,
            "to_date": to_date,
            "runs": runs,
        })))
    }
}

/// The analytics facts are for the people who plan: a viewer sees their own
/// roster elsewhere, never the ward's across a year.
fn require_analyst(roles: &RoleContext) -> Result<(), AppError> {
    if roles.can_write() {
        Ok(())
    } else {
        Err(AppError::Forbidden("Analytics are available to planners and admins".into()))
    }
}
