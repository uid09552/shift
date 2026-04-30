use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::CapabilityRepository;
use crate::services::employee::PaginationQuery;

pub struct CapabilityService;

impl CapabilityService {
    pub async fn list_capabilities(
        Query(_q): Query<PaginationQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let capabilities = state
            .capability_repo
            .list_capabilities()
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::to_value(capabilities).unwrap()))
    }

    pub async fn create_capability(
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'name'".into()))?;

        let capability = state
            .capability_repo
            .create_capability(name)
            .await
            .map_err(|e| match e.downcast_ref::<AppError>() {
                Some(AppError::Duplicate) => AppError::Duplicate,
                _ => AppError::Internal,
            })?;

        Ok(Json(serde_json::to_value(capability).unwrap()))
    }

    pub async fn get_capability_by_id(
        Path(capability_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let capability = state
            .capability_repo
            .get_capability(capability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(capability).unwrap()))
    }
}