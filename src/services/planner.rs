use axum::{
    extract::State,
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::services::scheduling::{SchedulingService, PlacedTask};

#[derive(Deserialize)]
pub struct PlanRequest {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Serialize)]
pub struct PlanResponse {
    pub task_id: String,
}

#[derive(Serialize)]
pub struct ListTasksResponse {
    pub tasks: Vec<PlacedTask>,
    pub count: usize,
}

pub struct PlannerService;

impl PlannerService {
    pub async fn trigger_plan(
        State(state): State<AppState>,
        Json(_body): Json<Value>,
    ) -> Result<Json<PlanResponse>, AppError> {
        let task_id = if let Some(nats_client) = &state.nats_client {
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status);
            match scheduling_service.request_scheduling().await {
                Ok(ack_id) => ack_id,
                Err(e) => {
                    eprintln!("Failed to send scheduling request: {}", e);
                    return Err(AppError::Internal);
                }
            }
        } else {
            Uuid::new_v4().to_string()
        };

        Ok(Json(PlanResponse { task_id }))
    }

    pub async fn list_tasks(
        State(state): State<AppState>,
    ) -> Result<Json<ListTasksResponse>, AppError> {
        if let Some(nats_client) = &state.nats_client {
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status);
            match scheduling_service.list_tasks().await {
                Ok(tasks) => {
                    let count = tasks.len();
                    Ok(Json(ListTasksResponse { tasks, count }))
                }
                Err(e) => {
                    eprintln!("Failed to list tasks: {}", e);
                    Err(AppError::Internal)
                }
            }
        } else {
            Err(AppError::Internal)
        }
    }

    pub async fn delete_all_tasks(
        State(state): State<AppState>,
    ) -> Result<StatusCode, AppError> {
        if let Some(nats_client) = &state.nats_client {
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status);
            if let Err(e) = scheduling_service.delete_all_tasks().await {
                eprintln!("Failed to delete tasks: {}", e);
                return Err(AppError::Internal);
            }
        } else {
            return Err(AppError::Internal);
        }
        Ok(StatusCode::NO_CONTENT)
    }
}
