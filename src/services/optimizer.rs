use async_nats::Client;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Json, Response},
};
use chrono::Local;
use crate::broker::JetStreamStatus;
use crate::errors::AppError;
use crate::models::{PlanningPeriod, ShiftTask, TaskDTO, TaskResultDto, EmployeeTask, WorkstationTask};
use crate::repository::{AppState, domain::*};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const OPTIMIZER_API_PATH: &str = "/api/v1/optimize";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacedTask {
    pub id: String,
    pub status: String,
}

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

pub struct OptimizerService {
    client: Client,
    jetstream_status: JetStreamStatus,
    state: AppState,
}

impl OptimizerService {
    pub fn new(client: Client, jetstream_status: JetStreamStatus, state: AppState) -> Self {
        Self { client, jetstream_status, state }
    }

    pub async fn build_task_dto(state: &AppState) -> Result<TaskDTO, Box<dyn std::error::Error + Send + Sync>> {
        println!("Fetching optimization data from database...");
        let shifts = state.shift_repo.list_shifts().await?;
        // Fetch ALL employees (None limit = no cap)
        let employees = state.employee_repo.list_employees(None, None).await?;
        let workstations = state.workstation_repo.list_workstations().await?;

        // Fetch all unavailabilities and group by employee_id for O(1) lookup
        let all_unavailabilities = state.unavailability_repo.list_unavailabilities().await?;
        let mut unavail_map: std::collections::HashMap<uuid::Uuid, Vec<String>> = std::collections::HashMap::new();
        for u in all_unavailabilities {
            unavail_map
                .entry(u.employee_id)
                .or_default()
                .push(u.unavailable_date.to_string());
        }

        let shift_tasks = Self::build_shift_tasks(shifts);
        let workstation_tasks: Vec<WorkstationTask> = workstations.into_iter().map(|ws| WorkstationTask {
            id: ws.id.to_string(),
            name: ws.name,
            required_skills: ws.required_capabilities.iter().map(|c| c.name.clone()).collect(),
            priority: "medium".to_string(),
            operating_shifts: ws.active_shift_ids.iter().map(|id| id.to_string()).collect(),
        }).collect();
        let employee_tasks: Vec<EmployeeTask> = employees.into_iter().map(|emp| {
            let unavailability = unavail_map.get(&emp.id).cloned().unwrap_or_default();
            EmployeeTask {
                id: emp.id.to_string(),
                name: emp.name,
                skills: emp.capabilities.iter().map(|c| c.name.clone()).collect(),
                available_shifts: emp.available_shifts.iter().map(|s| s.id.to_string()).collect(),
                unavailability,
                monthly_working_hours: emp.monthly_working_hours,
            }
        }).collect();
        let today = Local::now().naive_local().date();
        Ok(TaskDTO {
            planning_period: PlanningPeriod {
                start_date: today.to_string(),
                end_date: today.checked_add_signed(chrono::Duration::days(30)).unwrap_or(today).to_string(),
            },
            shifts: shift_tasks,
            workstations: workstation_tasks,
            employees: employee_tasks,
        })
    }

    fn build_shift_tasks(shifts: Vec<Shift>) -> Vec<ShiftTask> {
        shifts.into_iter().map(|shift| {
            let first_wt = shift.weekday_times.first();
            ShiftTask {
                id: shift.id.to_string(),
                name: shift.name,
                start_time: first_wt.map(|wt| wt.start_time.to_string()).unwrap_or_default(),
                end_time: first_wt.map(|wt| wt.end_time.to_string()).unwrap_or_default(),
                weekdays: shift.weekday_times.iter().map(|wt| wt.weekday.to_string()).collect(),
                is_night_shift: false,
                min_employees: first_wt.map(|wt| wt.min_employees).unwrap_or(1),
                max_employees: first_wt.and_then(|wt| wt.max_employees),
            }
        }).collect()
    }

    pub async fn request_optimization(&self) -> Result<OptimizedShiftResultDomain, Box<dyn std::error::Error + Send + Sync>> {
        let task_dto = Self::build_task_dto(&self.state).await?;
        let payload = serde_json::to_string(&task_dto)?;
        println!("Publishing optimization task with payload: {}", payload);
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                let ack = jetstream.publish("scheduling".to_string(), payload.clone().into()).await?.await?;
                println!("Published optimization task with ack id: {}", ack.sequence);
            }
            JetStreamStatus::Unavailable => {
                self.client.publish("scheduling".to_string(), payload.clone().into()).await?;
                self.client.flush().await?;
                println!("Published optimization task (plain)");
            }
        };
        let optimizer_url = format!("{}{}", self.state.optimizer_url, OPTIMIZER_API_PATH);
        println!("Publishing optimization payload to optimizer at: {}", optimizer_url);
        let response = reqwest::Client::new()
            .post(&optimizer_url)
            .header("Content-Type", "application/json")
            .body(payload.clone())
            .send()
            .await
            .map_err(|e| { eprintln!("Failed to publish to optimizer service: {}", e); e })?;
        let status = response.status();
        let result: TaskResultDto = response.json().await.map_err(|e| {
            eprintln!("Failed to deserialize optimizer response into TaskResultDto: {}", e);
            e
        })?;
        println!("Optimizer service responded with status: {}", status);
        let result_json = serde_json::to_value(&result)?;
        let stored = self.state.optimized_shift_result_repo.create_optimized_shift_result(result_json).await.map_err(|e| {
            eprintln!("Failed to store optimized shift result: {}", e);
            e
        })?;
        println!("Stored optimized shift result with id: {}", stored.id);
        let from_db = self.state.optimized_shift_result_repo.get_optimized_shift_result_by_id(stored.id).await
            .map_err(|e| { eprintln!("Failed to fetch stored optimized shift result: {}", e); e })?
            .ok_or("Stored result not found in database")?;
        Ok(from_db)
    }

    pub async fn list_tasks(&self) -> Result<Vec<PlacedTask>, String> {
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                match jetstream.get_stream("SCHEDULING").await {
                    Ok(mut stream) => match stream.info().await {
                        Ok(info) => {
                            let mut tasks = Vec::new();
                            for i in 1..=info.state.messages {
                                if let Ok(_message) = stream.get_raw_message(i).await {
                                    tasks.push(PlacedTask { id: i.to_string(), status: "queued".to_string() });
                                }
                            }
                            Ok(tasks)
                        }
                        Err(e) => Err(format!("Failed to get stream info: {}", e)),
                    },
                    Err(e) => Err(format!("Failed to get SCHEDULING stream: {}", e)),
                }
            }
            JetStreamStatus::Unavailable => Err("JetStream is unavailable".to_string()),
        }
    }

    pub async fn get_task(&self, task_id: u64) -> Result<String, String> {
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                match jetstream.get_stream("SCHEDULING").await {
                    Ok(stream) => match stream.get_raw_message(task_id).await {
                        Ok(message) => Ok(String::from_utf8_lossy(&message.payload).to_string()),
                        Err(e) => Err(format!("Failed to get message: {}", e)),
                    },
                    Err(e) => Err(format!("Failed to get SCHEDULING stream: {}", e)),
                }
            }
            JetStreamStatus::Unavailable => Err("JetStream is unavailable".to_string()),
        }
    }

    pub async fn delete_all_tasks(&self) -> Result<(), String> {
        match self.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(self.client.clone());
                match jetstream.get_stream("SCHEDULING").await {
                    Ok(stream) => match stream.purge().await {
                        Ok(_) => Ok(()),
                        Err(e) => Err(format!("Failed to purge stream: {}", e)),
                    },
                    Err(e) => Err(format!("Failed to get SCHEDULING stream: {}", e)),
                }
            }
            JetStreamStatus::Unavailable => Err("JetStream is unavailable".to_string()),
        }
    }
}

pub async fn trigger_plan(State(state): State<AppState>) -> Result<Json<OptimizedShiftResultResponse>, AppError> {
    if let Some(nats_client) = &state.nats_client {
        let optimizer_service = OptimizerService::new(nats_client.clone(), state.jetstream_status, state.clone());
        match optimizer_service.request_optimization().await {
            Ok(stored) => {
                let result_dto: TaskResultDto = serde_json::from_value(stored.result)
                    .map_err(|e| { eprintln!("Failed to deserialize stored result: {}", e); AppError::Internal })?;
                Ok(Json(OptimizedShiftResultResponse { id: stored.id, result: result_dto, creation_date: stored.creation_date }))
            }
            Err(e) => { eprintln!("Failed to send optimization request: {}", e); Err(AppError::Internal) }
        }
    } else {
        Err(AppError::Internal)
    }
}

pub async fn list_optimized_shifts(
    Query(q): Query<ListOptimizedShiftResultsQuery>,
    State(state): State<AppState>,
) -> Result<Json<PaginatedOptimizedShiftResultsResponse>, AppError> {
    if q.latest.unwrap_or(false) {
        let latest = state.optimized_shift_result_repo.get_latest_optimized_shift_result().await
            .map_err(|e| { eprintln!("Failed to get latest optimized shift result: {}", e); AppError::Internal })?;
        let data: Vec<OptimizedShiftResultResponse> = latest.into_iter().filter_map(|r| {
            let result_dto: TaskResultDto = serde_json::from_value(r.result.clone()).ok()?;
            Some(OptimizedShiftResultResponse { id: r.id, result: result_dto, creation_date: r.creation_date })
        }).collect();
        let total = if data.is_empty() { 0i64 } else { 1i64 };
        return Ok(Json(PaginatedOptimizedShiftResultsResponse { data, total, limit: 1, offset: 0 }));
    }
    let limit = q.limit.map(|l| l as i64);
    let offset = q.offset.map(|o| o as i64);
    let results = state.optimized_shift_result_repo.list_optimized_shift_results(limit, offset).await
        .map_err(|e| { eprintln!("Failed to list optimized shift results: {}", e); AppError::Internal })?;
    let total = state.optimized_shift_result_repo.count_optimized_shift_results().await
        .map_err(|e| { eprintln!("Failed to count optimized shift results: {}", e); AppError::Internal })?;
    let data: Vec<OptimizedShiftResultResponse> = results.into_iter().filter_map(|r| {
        let result_dto: TaskResultDto = serde_json::from_value(r.result.clone()).ok()?;
        Some(OptimizedShiftResultResponse { id: r.id, result: result_dto, creation_date: r.creation_date })
    }).collect();
    Ok(Json(PaginatedOptimizedShiftResultsResponse { data, total, limit: limit.unwrap_or(50), offset: offset.unwrap_or(0) }))
}

pub async fn get_optimized_shift(
    Path(result_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<OptimizedShiftResultResponse>, AppError> {
    let stored = state.optimized_shift_result_repo.get_optimized_shift_result_by_id(result_id).await
        .map_err(|e| { eprintln!("Failed to get optimized shift result: {}", e); AppError::Internal })?
        .ok_or(AppError::NotFound)?;
    let result_dto: TaskResultDto = serde_json::from_value(stored.result)
        .map_err(|e| { eprintln!("Failed to deserialize stored result: {}", e); AppError::Internal })?;
    Ok(Json(OptimizedShiftResultResponse { id: stored.id, result: result_dto, creation_date: stored.creation_date }))
}

pub async fn delete_optimized_shift(
    Path(result_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<StatusCode, AppError> {
    state.optimized_shift_result_repo.delete_optimized_shift_result(result_id).await
        .map_err(|e| {
            if let Some(app_err) = e.downcast_ref::<AppError>() {
                if matches!(app_err, AppError::NotFound) { return AppError::NotFound; }
            }
            eprintln!("Failed to delete optimized shift result: {}", e);
            AppError::Internal
        })?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_tasks(State(state): State<AppState>) -> Result<Json<ListTasksResponse>, AppError> {
    if let Some(nats_client) = &state.nats_client {
        let optimizer_service = OptimizerService::new(nats_client.clone(), state.jetstream_status, state.clone());
        match optimizer_service.list_tasks().await {
            Ok(tasks) => Ok(Json(ListTasksResponse { tasks: tasks.clone(), count: tasks.len() })),
            Err(e) => { eprintln!("Failed to list tasks: {}", e); Err(AppError::Internal) }
        }
    } else {
        Err(AppError::Internal)
    }
}

pub async fn get_task(State(state): State<AppState>, Path(task_id): Path<u64>) -> Result<Response, AppError> {
    if let Some(nats_client) = &state.nats_client {
        let optimizer_service = OptimizerService::new(nats_client.clone(), state.jetstream_status, state.clone());
        match optimizer_service.get_task(task_id).await {
            Ok(payload) => Ok(Response::builder().status(StatusCode::OK).header("content-type", "application/json").body(Body::from(payload)).map_err(|_| AppError::Internal)?),
            Err(e) => { eprintln!("Failed to get task: {}", e); Err(AppError::Internal) }
        }
    } else {
        Err(AppError::Internal)
    }
}

pub async fn delete_all_tasks(State(state): State<AppState>) -> Result<StatusCode, AppError> {
    if let Some(nats_client) = &state.nats_client {
        let optimizer_service = OptimizerService::new(nats_client.clone(), state.jetstream_status, state.clone());
        if let Err(e) = optimizer_service.delete_all_tasks().await {
            eprintln!("Failed to delete tasks: {}", e);
            return Err(AppError::Internal);
        }
    } else {
        return Err(AppError::Internal);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn prepare(State(state): State<AppState>) -> Result<Json<TaskDTO>, AppError> {
    match OptimizerService::build_task_dto(&state).await {
        Ok(task_dto) => Ok(Json(task_dto)),
        Err(e) => {
            eprintln!("Failed to prepare task DTO: {}", e);
            Err(AppError::Internal)
        }
    }
}
