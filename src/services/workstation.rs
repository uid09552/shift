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
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::TenantContext;

#[derive(Deserialize)]
pub struct ListWorkstationsQuery {
    pub available: Option<bool>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub struct WorkstationService;

impl WorkstationService {
    pub async fn list_workstations(
        tenant: TenantContext,
        Query(_q): Query<ListWorkstationsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let workstations = state
            .workstation_repo
            .list_workstations(&tenant.0)
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::to_value(workstations).unwrap()))
    }

    pub async fn create_workstation(
        tenant: TenantContext,
        actor: AuditActor,
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

        let min_employees = body
            .get("min_employees")
            .and_then(|v| v.as_i64())
            .unwrap_or(1) as i16;
        if min_employees < 0 {
            return Err(AppError::Validation("min_employees must be >= 0".into()));
        }

        let max_employees = body
            .get("max_employees")
            .and_then(|v| if v.is_null() { None } else { v.as_i64() })
            .map(|v| v as i16);
        if let Some(max) = max_employees {
            if max < min_employees {
                return Err(AppError::Validation(
                    "max_employees must be >= min_employees".into(),
                ));
            }
        }

        let workstation = state
            .workstation_repo
            .create_workstation(&tenant.0, name, available, active_shift_ids, priority, min_employees, max_employees)
            .await
            .map_err(|_| AppError::Internal)?;

        audit_log::record(&state, &tenant.0, actor.0, "workstation.create", "workstation", Some(workstation.id.to_string()), Some(body.to_string())).await;

        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn get_workstation_by_id(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let workstation = state
            .workstation_repo
            .get_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn update_workstation(
        tenant: TenantContext,
        actor: AuditActor,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        // Update availability if provided
        if let Some(available) = body.get("available").and_then(|v| v.as_bool()) {
            state
                .workstation_repo
                .set_workstation_availability(&tenant.0, workstation_id, available)
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
                .set_workstation_active_shifts(&tenant.0, workstation_id, active_shift_ids)
                .await
                .map_err(|_| AppError::Internal)?;
        }

        // Update priority if provided
        if let Some(priority) = body.get("priority").and_then(|v| v.as_str()) {
            state
                .workstation_repo
                .set_workstation_priority(&tenant.0, workstation_id, priority)
                .await
                .map_err(|_| AppError::Internal)?;
        }

        // Update staffing limits if provided
        if body.get("min_employees").is_some() || body.get("max_employees").is_some() {
            let current = state
                .workstation_repo
                .get_workstation(&tenant.0, workstation_id)
                .await
                .map_err(|_| AppError::Internal)?
                .ok_or(AppError::NotFound)?;

            let min_employees = body
                .get("min_employees")
                .and_then(|v| v.as_i64())
                .map(|v| v as i16)
                .unwrap_or(current.min_employees);
            if min_employees < 0 {
                return Err(AppError::Validation("min_employees must be >= 0".into()));
            }

            let max_employees = if let Some(v) = body.get("max_employees") {
                if v.is_null() { None } else { v.as_i64().map(|v| v as i16) }
            } else {
                current.max_employees
            };
            if let Some(max) = max_employees {
                if max < min_employees {
                    return Err(AppError::Validation(
                        "max_employees must be >= min_employees".into(),
                    ));
                }
            }

            state
                .workstation_repo
                .set_workstation_staffing(&tenant.0, workstation_id, min_employees, max_employees)
                .await
                .map_err(|_| AppError::Internal)?;
        }

        // Return the updated workstation
        let workstation = state
            .workstation_repo
            .get_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        audit_log::record(&state, &tenant.0, actor.0, "workstation.update", "workstation", Some(workstation_id.to_string()), Some(body.to_string())).await;

        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn enable_workstation(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state.workstation_repo
            .set_workstation_availability(&tenant.0, workstation_id, true)
            .await
            .map_err(|_| AppError::Internal)?;
        let workstation = state.workstation_repo
            .get_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn disable_workstation(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state.workstation_repo
            .set_workstation_availability(&tenant.0, workstation_id, false)
            .await
            .map_err(|_| AppError::Internal)?;
        let workstation = state.workstation_repo
            .get_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn set_workstation_availability(
        tenant: TenantContext,
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
            .set_workstation_availability(&tenant.0, workstation_id, available)
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
                .set_workstation_active_shifts(&tenant.0, workstation_id, active_shift_ids)
                .await
                .map_err(|_| AppError::Internal)?;
        }

        // Return the updated workstation
        let workstation = state
            .workstation_repo
            .get_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        Ok(Json(serde_json::to_value(workstation).unwrap()))
    }

    pub async fn get_workstation_required_capabilities(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let capabilities = state
            .workstation_repo
            .list_required_capabilities(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::to_value(capabilities).unwrap()))
    }

    pub async fn add_workstation_required_capability(
        tenant: TenantContext,
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
            .add_required_capability(&tenant.0, workstation_id, capability_id)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::json!({ "message": "Capability added successfully" })))
    }

    pub async fn delete_workstation(
        tenant: TenantContext,
        actor: AuditActor,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .workstation_repo
            .delete_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?;
        audit_log::record(&state, &tenant.0, actor.0, "workstation.delete", "workstation", Some(workstation_id.to_string()), None).await;
        Ok(Json(serde_json::json!({ "message": "Workstation deleted successfully" })))
    }
}
