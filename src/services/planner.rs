use axum::{
    extract::{State, Path},
    Json,
    http::StatusCode,
    body::Body,
    response::Response,
};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::models::TaskDTO;
use crate::repository::AppState;
use crate::services::scheduling::{SchedulingService, PlacedTask};

#[derive(Deserialize)]
pub struct PlanRequest {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
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
    ) -> Result<Response, AppError> {
        if let Some(nats_client) = &state.nats_client {
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status, state.clone());
            match scheduling_service.request_scheduling().await {
                Ok(body) => {
                    Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "application/json")
                        .body(Body::from(body))
                        .map_err(|_| AppError::Internal)?)
                }
                Err(e) => {
                    eprintln!("Failed to send scheduling request: {}", e);
                    Err(AppError::Internal)
                }
            }
        } else {
            Err(AppError::Internal)
        }
    }

    pub async fn list_tasks(
        State(state): State<AppState>,
    ) -> Result<Json<ListTasksResponse>, AppError> {
        if let Some(nats_client) = &state.nats_client {
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status, state.clone());
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

    pub async fn get_task(
        State(state): State<AppState>,
        Path(task_id): Path<u64>,
    ) -> Result<Response, AppError> {
        if let Some(nats_client) = &state.nats_client {
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status, state.clone());
            match scheduling_service.get_task(task_id).await {
                Ok(payload) => {
                    Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "application/json")
                        .body(Body::from(payload))
                        .map_err(|_| AppError::Internal)?)
                }
                Err(e) => {
                    eprintln!("Failed to get task: {}", e);
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
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status, state.clone());
            if let Err(e) = scheduling_service.delete_all_tasks().await {
                eprintln!("Failed to delete tasks: {}", e);
                return Err(AppError::Internal);
            }
        } else {
            return Err(AppError::Internal);
        }
        Ok(StatusCode::NO_CONTENT)
    }

    /// Prepare an optimization request by building the `TaskDTO` structure
    /// from the current database state and returning it without actually
    /// triggering the optimizer.
    pub async fn prepare(
        State(state): State<AppState>,
    ) -> Result<Json<TaskDTO>, AppError> {
        match SchedulingService::build_task_dto(&state).await {
            Ok(task_dto) => Ok(Json(task_dto)),
            Err(e) => {
                eprintln!("Failed to prepare task DTO: {}", e);
                Err(AppError::Internal)
            }
        }
    }
}
