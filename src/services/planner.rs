use axum::{
    extract::{State, Path, Query},
    Json,
    http::StatusCode,
    body::Body,
    response::Response,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{TaskDTO, TaskResultDto};
use crate::repository::AppState;
use crate::repository::domain::OptimizedShiftResultRepository;
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

#[derive(Deserialize)]
pub struct ListOptimizedShiftResultsQuery {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
    pub latest: Option<bool>,
}

#[derive(Serialize)]
pub struct OptimizedShiftResultResponse {
    pub id: Uuid,
    pub result: TaskResultDto,
    pub creation_date: chrono::NaiveDateTime,
}

#[derive(Serialize)]
pub struct PaginatedOptimizedShiftResultsResponse {
    pub data: Vec<OptimizedShiftResultResponse>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

pub struct PlannerService;

impl PlannerService {
    pub async fn trigger_plan(
        State(state): State<AppState>,
    ) -> Result<Json<OptimizedShiftResultResponse>, AppError> {
        if let Some(nats_client) = &state.nats_client {
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status, state.clone());
            match scheduling_service.request_scheduling().await {
                Ok(stored) => {
                    let result_dto: TaskResultDto = serde_json::from_value(stored.result)
                        .map_err(|e| {
                            eprintln!("Failed to deserialize stored result: {}", e);
                            AppError::Internal
                        })?;
                    Ok(Json(OptimizedShiftResultResponse {
                        id: stored.id,
                        result: result_dto,
                        creation_date: stored.creation_date,
                    }))
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

    /// GET /planner/optimized-shifts
    /// Lists all stored optimized shift results with pagination, ordered by creation date descending.
    /// When latest=true, returns only the most recent optimization result.
    pub async fn list_optimized_shifts(
        Query(q): Query<ListOptimizedShiftResultsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<PaginatedOptimizedShiftResultsResponse>, AppError> {
        if q.latest.unwrap_or(false) {
            let latest = state
                .optimized_shift_result_repo
                .get_latest_optimized_shift_result()
                .await
                .map_err(|e| {
                    eprintln!("Failed to get latest optimized shift result: {}", e);
                    AppError::Internal
                })?;

            let data: Vec<OptimizedShiftResultResponse> = latest
                .into_iter()
                .filter_map(|r| {
                    let result_dto: TaskResultDto = serde_json::from_value(r.result.clone()).ok()?;
                    Some(OptimizedShiftResultResponse {
                        id: r.id,
                        result: result_dto,
                        creation_date: r.creation_date,
                    })
                })
                .collect();

            let total = if data.is_empty() { 0i64 } else { 1i64 };

            return Ok(Json(PaginatedOptimizedShiftResultsResponse {
                data,
                total,
                limit: 1,
                offset: 0,
            }));
        }

        let limit = q.limit.map(|l| l as i64);
        let offset = q.offset.map(|o| o as i64);

        let results = state
            .optimized_shift_result_repo
            .list_optimized_shift_results(limit, offset)
            .await
            .map_err(|e| {
                eprintln!("Failed to list optimized shift results: {}", e);
                AppError::Internal
            })?;

        let total = state
            .optimized_shift_result_repo
            .count_optimized_shift_results()
            .await
            .map_err(|e| {
                eprintln!("Failed to count optimized shift results: {}", e);
                AppError::Internal
            })?;

        let data: Vec<OptimizedShiftResultResponse> = results
            .into_iter()
            .filter_map(|r| {
                let result_dto: TaskResultDto = serde_json::from_value(r.result.clone()).ok()?;
                Some(OptimizedShiftResultResponse {
                    id: r.id,
                    result: result_dto,
                    creation_date: r.creation_date,
                })
            })
            .collect();

        Ok(Json(PaginatedOptimizedShiftResultsResponse {
            data,
            total,
            limit: limit.unwrap_or(50),
            offset: offset.unwrap_or(0),
        }))
    }

    /// GET /planner/optimized-shifts/:result_id
    /// Gets a specific optimized shift result by ID.
    pub async fn get_optimized_shift(
        Path(result_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<OptimizedShiftResultResponse>, AppError> {
        let stored = state
            .optimized_shift_result_repo
            .get_optimized_shift_result_by_id(result_id)
            .await
            .map_err(|e| {
                eprintln!("Failed to get optimized shift result: {}", e);
                AppError::Internal
            })?
            .ok_or(AppError::NotFound)?;

        let result_dto: TaskResultDto = serde_json::from_value(stored.result)
            .map_err(|e| {
                eprintln!("Failed to deserialize stored result: {}", e);
                AppError::Internal
            })?;

        Ok(Json(OptimizedShiftResultResponse {
            id: stored.id,
            result: result_dto,
            creation_date: stored.creation_date,
        }))
    }

    /// DELETE /planner/optimized-shifts/:result_id
    /// Deletes a specific optimized shift result.
    pub async fn delete_optimized_shift(
        Path(result_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<StatusCode, AppError> {
        state
            .optimized_shift_result_repo
            .delete_optimized_shift_result(result_id)
            .await
            .map_err(|e| {
                if let Some(app_err) = e.downcast_ref::<AppError>() {
                    if matches!(app_err, AppError::NotFound) {
                        return AppError::NotFound;
                    }
                }
                eprintln!("Failed to delete optimized shift result: {}", e);
                AppError::Internal
            })?;

        Ok(StatusCode::NO_CONTENT)
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
