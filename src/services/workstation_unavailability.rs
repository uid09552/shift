use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::{WorkstationRepository, WorkstationUnavailability, WorkstationUnavailabilityRepository};
use crate::services::tenant::TenantContext;

#[derive(Deserialize)]
pub struct ListWorkstationUnavailabilitiesQuery {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

pub struct WorkstationUnavailabilityService;

impl WorkstationUnavailabilityService {
    pub async fn list_workstation_unavailabilities(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        Query(q): Query<ListWorkstationUnavailabilitiesQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let unavailabilities = state
            .workstation_unavailability_repo
            .get_unavailabilities_for_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?;

        // Client-side overlap filtering if both from_date and to_date are provided
        let filtered = if let (Some(from_str), Some(to_str)) = (q.from_date, q.to_date) {
            let from_date = NaiveDate::parse_from_str(&from_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
            let to_date = NaiveDate::parse_from_str(&to_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;
            unavailabilities
                .into_iter()
                .filter(|u| u.unavailable_from <= to_date && u.unavailable_to >= from_date)
                .collect()
        } else {
            unavailabilities
        };

        Ok(Json(serde_json::to_value(filtered).unwrap()))
    }

    pub async fn create_workstation_unavailability(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        // Verify workstation exists
        state
            .workstation_repo
            .get_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        let from_str = body
            .get("unavailable_from")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'unavailable_from'".into()))?;
        let unavailable_from = NaiveDate::parse_from_str(from_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'unavailable_from' format, use YYYY-MM-DD".into()))?;

        let to_str = body
            .get("unavailable_to")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'unavailable_to'".into()))?;
        let unavailable_to = NaiveDate::parse_from_str(to_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'unavailable_to' format, use YYYY-MM-DD".into()))?;

        if unavailable_to < unavailable_from {
            return Err(AppError::Validation(
                "unavailable_to must be >= unavailable_from".into(),
            ));
        }

        let unavailability = WorkstationUnavailability {
            id: Uuid::new_v4(), // Will be replaced by DB-generated ID
            workstation_id,
            unavailable_from,
            unavailable_to,
        };

        let created = state
            .workstation_unavailability_repo
            .create_workstation_unavailability(&tenant.0, unavailability)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    pub async fn get_workstation_unavailability_by_id(
        tenant: TenantContext,
        Path((_workstation_id, unavailability_id)): Path<(Uuid, Uuid)>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let unavailability = state
            .workstation_unavailability_repo
            .get_workstation_unavailability(&tenant.0, unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(unavailability).unwrap()))
    }

    pub async fn delete_workstation_unavailability(
        tenant: TenantContext,
        Path((_workstation_id, unavailability_id)): Path<(Uuid, Uuid)>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .workstation_unavailability_repo
            .get_workstation_unavailability(&tenant.0, unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        state
            .workstation_unavailability_repo
            .delete_workstation_unavailability(&tenant.0, unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::json!({ "message": "Workstation unavailability deleted successfully" })))
    }
}
