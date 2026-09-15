use axum::{
    extract::{Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::Value;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::AnalysisRepository;
use crate::services::tenant::TenantContext;

#[derive(Deserialize)]
pub struct AnalysisQuery {
    pub from_date: String,
    pub to_date: String,
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
        let from_date = NaiveDate::parse_from_str(&q.from_date, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
        let to_date = NaiveDate::parse_from_str(&q.to_date, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;

        if from_date > to_date {
            return Err(AppError::Validation("from_date must be before or equal to to_date".into()));
        }
        // A year is plenty for "this quarter" questions and keeps the load bounded.
        if (to_date - from_date).num_days() > 366 {
            return Err(AppError::Validation("The period may cover at most one year".into()));
        }

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
}
