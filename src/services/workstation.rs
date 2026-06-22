use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::WorkstationRepository;

#[derive(Deserialize)]
pub struct ListWorkstationsQuery {
    pub available: Option<bool>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub struct WorkstationService;

impl WorkstationService {
    pub async fn list_workstations(
        Query(_q): Query<ListWorkstationsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let workstations = state
            .workstation_repo
            .list_workstations()
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::to_value(workstations).unwrap()))
    }

    pub async fn create_workstation(
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'name'".into()))?;

        let available = body
            .get("available")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let active_shift_ids = body
            .get("active_shift_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().and_then(|s| s.parse::<Uuid>().ok()))
                    .collect::<Vec<Uuid>>()
            })
            .unwrap_or_default();

        let priority = body
            .get("priority")
            .and_then(|v| v.as_str())
            .unwrap_or("medium");

        let workstation = state
            .workstation_repo
            .create_workstation(name, available, active_shift_ids, priority)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn get_workstation_by_id(
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let workstation = state
            .workstation_repo
            .get_workstation(workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn update_workstation(
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        // Update availability if provided
        if let Some(available) = body.get("available").and_then(|v| v.as_bool()) {
            state
                .workstation_repo
                .set_workstation_availability(workstation_id, available)
                .await
                .map_err(|_| AppError::Internal)?;
        }

        // Update active shifts if provided
        if let Some(active_shift_ids_val) = body.get("active_shift_ids") {
            let active_shift_ids = if active_shift_ids_val.is_null() {
                vec![]
            } else {
                active_shift_ids_val
                    .as_array()
                    .ok_or_else(|| AppError::Validation("Invalid 'active_shift_ids': expected array".into()))?
                    .iter()
                    .filter_map(|v| v.as_str().and_then(|s| s.parse::<Uuid>().ok()))
                    .collect::<Vec<Uuid>>()
            };
            state
                .workstation_repo
                .set_workstation_active_shifts(workstation_id, active_shift_ids)
                .await
                .map_err(|_| AppError::Internal)?;
        }

        // Update priority if provided
        if let Some(priority) = body.get("priority").and_then(|v| v.as_str()) {
            state
                .workstation_repo
                .set_workstation_priority(workstation_id, priority)
                .await
                .map_err(|_| AppError::Internal)?;
        }

        // Return the updated workstation
        let workstation = state
            .workstation_repo
            .get_workstation(workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn set_workstation_availability(
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let available = body
            .get("available")
            .and_then(|v| v.as_bool())
            .ok_or_else(|| AppError::Validation("Missing 'available'".into()))?;

        state
            .workstation_repo
            .set_workstation_availability(workstation_id, available)
            .await
            .map_err(|_| AppError::Internal)?;

        // Also update active_shift_ids if provided
        if let Some(active_shift_ids_val) = body.get("active_shift_ids") {
            let active_shift_ids = if active_shift_ids_val.is_null() {
                vec![]
            } else {
                active_shift_ids_val
                    .as_array()
                    .ok_or_else(|| AppError::Validation("Invalid 'active_shift_ids': expected array".into()))?
                    .iter()
                    .filter_map(|v| v.as_str().and_then(|s| s.parse::<Uuid>().ok()))
                    .collect::<Vec<Uuid>>()
            };
            state
                .workstation_repo
                .set_workstation_active_shifts(workstation_id, active_shift_ids)
                .await
                .map_err(|_| AppError::Internal)?;
        }

        // Return the updated workstation
        let workstation = state
            .workstation_repo
            .get_workstation(workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn get_workstation_required_capabilities(
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let capabilities = state
            .workstation_repo
            .list_required_capabilities(workstation_id)
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::to_value(capabilities).unwrap()))
    }

    pub async fn add_workstation_required_capability(
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let capability_id = body
            .get("capability_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'capability_id'".into()))?
            .parse::<Uuid>()
            .map_err(|_| AppError::Validation("Invalid 'capability_id' UUID".into()))?;

        state
            .workstation_repo
            .add_required_capability(workstation_id, capability_id)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::json!({ "message": "Capability added successfully" })))
    }

    pub async fn delete_workstation(
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .workstation_repo
            .delete_workstation(workstation_id)
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::json!({ "message": "Workstation deleted successfully" })))
    }
}
