use futures_util::StreamExt;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Json, Response},
};
use chrono::Local;
use crate::broker::JetStreamStatus;
use crate::errors::AppError;
use crate::models::{ConstraintTask, PlanningPeriod, ShiftTask, TaskDTO, TaskResultDto, EmployeeTask, WorkstationTask};
use crate::repository::{AppState, domain::*};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const NATS_SCHEDULING_SUBJECT: &str = "scheduling";
pub const NATS_RESULTS_SUBJECT: &str = "scheduling.results";

// ── Request/Response types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningTaskResponse {
    pub id: Uuid,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

impl From<PlanningTaskDomain> for PlanningTaskResponse {
    fn from(t: PlanningTaskDomain) -> Self {
        Self {
            id: t.id,
            status: t.status,
            result_id: t.result_id,
            error_message: t.error_message,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }
    }
}

#[derive(Serialize)]
pub struct ListTasksResponse {
    pub tasks: Vec<PlanningTaskResponse>,
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

#[derive(Deserialize)]
pub struct PlanRequest {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub employee_ids: Option<Vec<Uuid>>,
    pub monthly_hours_target_weight: Option<u64>,
}

#[derive(Serialize)]
pub struct PlanTaskResponse {
    pub task_id: Uuid,
}

#[derive(Serialize)]
pub struct PlanTaskStatusResponse {
    pub task_id: Uuid,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_id: Option<Uuid>,
}

// ── OptimizerService ─────────────────────────────────────────────────────────

pub struct OptimizerService {
    state: AppState,
}

impl OptimizerService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn build_task_dto(
        state: &AppState,
        employee_filter: Option<&[Uuid]>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        constraints: Option<ConstraintTask>,
    ) -> Result<TaskDTO, Box<dyn std::error::Error + Send + Sync>> {
        let shifts = state.shift_repo.list_shifts().await?;

        let employees = if let Some(ids) = employee_filter {
            if ids.is_empty() {
                state.employee_repo.list_employees(None, None).await?
            } else {
                state.employee_repo.list_employees_by_ids(ids).await?
            }
        } else {
            state.employee_repo.list_employees(None, None).await?
        };

        let workstations = state.workstation_repo.list_workstations().await?;

        let all_unavailabilities = state.unavailability_repo.list_unavailabilities().await?;
        let mut unavail_map: std::collections::HashMap<Uuid, Vec<String>> = std::collections::HashMap::new();
        for u in all_unavailabilities {
            unavail_map.entry(u.employee_id).or_default().push(u.unavailable_date.to_string());
        }

        let shift_tasks = Self::build_shift_tasks(shifts);
        let workstation_tasks: Vec<WorkstationTask> = workstations.into_iter().map(|ws| WorkstationTask {
            id: ws.id.to_string(),
            name: ws.name,
            required_skills: ws.required_capabilities.iter().map(|c| c.name.clone()).collect(),
            priority: ws.priority.clone(),
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
        let period_start = start_date
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .unwrap_or(today);
        let period_end = end_date
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .unwrap_or_else(|| today.checked_add_signed(chrono::Duration::days(27)).unwrap_or(today));

        Ok(TaskDTO {
            planning_period: PlanningPeriod {
                start_date: period_start.to_string(),
                end_date: period_end.to_string(),
            },
            shifts: shift_tasks,
            workstations: workstation_tasks,
            employees: employee_tasks,
            constraints,
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

    /// Build task DTO, store it in the DB, publish to NATS, return the task_id.
    pub async fn schedule(
        &self,
        task_id: Uuid,
        employee_filter: Option<&[Uuid]>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        constraints: Option<ConstraintTask>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let nats_client = self.state.nats_client.as_ref()
            .ok_or("NATS client not configured")?;

        let task_dto = Self::build_task_dto(&self.state, employee_filter, start_date, end_date, constraints).await?;

        // Wrap with job_id so the Python can echo it back
        let mut payload_value = serde_json::to_value(&task_dto)?;
        if let serde_json::Value::Object(ref mut map) = payload_value {
            map.insert("job_id".to_string(), serde_json::Value::String(task_id.to_string()));
        }
        let payload_bytes = serde_json::to_vec(&payload_value)?;

        // Store task in DB
        self.state.planning_task_repo.create_planning_task(task_id, payload_value).await?;

        // Publish to NATS JetStream (preferred) or plain NATS
        match self.state.jetstream_status {
            JetStreamStatus::Available => {
                let jetstream = async_nats::jetstream::new(nats_client.clone());
                let ack = jetstream.publish(NATS_SCHEDULING_SUBJECT, payload_bytes.into()).await?.await?;
                println!("Published task {} to JetStream (seq {})", task_id, ack.sequence);
            }
            JetStreamStatus::Unavailable => {
                nats_client.publish(NATS_SCHEDULING_SUBJECT, payload_bytes.into()).await?;
                nats_client.flush().await?;
                println!("Published task {} to NATS (plain)", task_id);
            }
        }

        Ok(())
    }
}

// ── Background NATS result subscriber ────────────────────────────────────────

/// Spawns a long-lived tokio task that subscribes to `scheduling.results`
/// and updates planning_task status when results arrive.
pub fn start_result_subscriber(state: AppState) {
    tokio::spawn(async move {
        let Some(nats_client) = &state.nats_client else {
            println!("No NATS client — result subscriber not started");
            return;
        };

        let sub = match nats_client.subscribe(NATS_RESULTS_SUBJECT).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to subscribe to {}: {}", NATS_RESULTS_SUBJECT, e);
                return;
            }
        };
        println!("Subscribed to NATS subject '{}'", NATS_RESULTS_SUBJECT);

        let mut sub = sub;
        while let Some(msg) = sub.next().await {
            let state = state.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_result_message(state, &msg.payload).await {
                    eprintln!("Error handling result message: {}", e);
                }
            });
        }
        eprintln!("NATS result subscriber ended unexpectedly");
    });
}

async fn handle_result_message(
    state: AppState,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let raw: serde_json::Value = serde_json::from_slice(payload)?;

    // job_id may be absent on old/legacy messages — skip silently
    let Some(job_id_str) = raw.get("job_id").and_then(|v| v.as_str()) else {
        eprintln!("Result message missing job_id — skipping (raw: {})", &raw.to_string()[..200.min(raw.to_string().len())]);
        return Ok(());
    };
    let job_id: Uuid = job_id_str.parse()?;

    // Check status field for errors from optimizer
    let opt_status = raw.get("status").and_then(|v| v.as_str()).unwrap_or("unknown");
    if opt_status == "error" || opt_status == "validation_error" {
        let msg = raw.get("message").and_then(|v| v.as_str()).unwrap_or("optimizer error").to_string();
        eprintln!("Optimizer reported error for task {}: {}", job_id, msg);
        state.planning_task_repo.update_planning_task_error(job_id, msg).await?;
        return Ok(());
    }

    // Deserialize the result, store it, update task
    let result_dto: TaskResultDto = serde_json::from_value(raw.clone())?;
    let result_json = serde_json::to_value(&result_dto)?;
    let stored = state.optimized_shift_result_repo.create_optimized_shift_result(result_json).await?;
    state.planning_task_repo.update_planning_task_done(job_id, stored.id).await?;
    println!("Task {} done — result stored as {}", job_id, stored.id);

    Ok(())
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

pub async fn trigger_plan(
    State(state): State<AppState>,
    Json(request): Json<PlanRequest>,
) -> Result<Json<PlanTaskResponse>, AppError> {
    if state.nats_client.is_none() {
        return Err(AppError::Internal);
    }

    let task_id = Uuid::new_v4();
    let employee_ids = request.employee_ids.clone();
    let start_date = request.start_date.clone();
    let end_date = request.end_date.clone();
    let constraints = request.monthly_hours_target_weight.map(|w| ConstraintTask {
        monthly_hours_target_weight: Some(w),
    });

    let svc = OptimizerService::new(state.clone());
    if let Err(e) = svc.schedule(
        task_id,
        employee_ids.as_deref(),
        start_date.as_deref(),
        end_date.as_deref(),
        constraints,
    ).await {
        eprintln!("Failed to schedule task {}: {}", task_id, e);
        return Err(AppError::Internal);
    }

    Ok(Json(PlanTaskResponse { task_id }))
}

pub async fn get_plan_status(
    Path(task_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<PlanTaskStatusResponse>, AppError> {
    let task = state.planning_task_repo.get_planning_task(task_id).await
        .map_err(|e| { eprintln!("Failed to get task status: {}", e); AppError::Internal })?
        .ok_or(AppError::NotFound)?;

    let status = match task.status.as_str() {
        "done" => "completed",
        "error" => "failed",
        _ => "running",
    };

    Ok(Json(PlanTaskStatusResponse {
        task_id,
        status: status.to_string(),
        result_id: task.result_id,
    }))
}

pub async fn list_tasks(State(state): State<AppState>) -> Result<Json<ListTasksResponse>, AppError> {
    let tasks = state.planning_task_repo.list_planning_tasks().await
        .map_err(|e| { eprintln!("Failed to list tasks: {}", e); AppError::Internal })?;
    let count = tasks.len();
    Ok(Json(ListTasksResponse {
        tasks: tasks.into_iter().map(PlanningTaskResponse::from).collect(),
        count,
    }))
}

pub async fn get_task(
    Path(task_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let task = state.planning_task_repo.get_planning_task(task_id).await
        .map_err(|e| { eprintln!("Failed to get task: {}", e); AppError::Internal })?
        .ok_or(AppError::NotFound)?;
    let body = serde_json::to_vec(&PlanningTaskResponse::from(task))
        .map_err(|_| AppError::Internal)?;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .map_err(|_| AppError::Internal)?)
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

pub async fn prepare(
    State(state): State<AppState>,
    Json(request): Json<PlanRequest>,
) -> Result<Json<TaskDTO>, AppError> {
    let employee_filter = request.employee_ids.as_deref();
    let constraints = request.monthly_hours_target_weight.map(|w| ConstraintTask {
        monthly_hours_target_weight: Some(w),
    });
    match OptimizerService::build_task_dto(&state, employee_filter, request.start_date.as_deref(), request.end_date.as_deref(), constraints).await {
        Ok(task_dto) => Ok(Json(task_dto)),
        Err(e) => {
            eprintln!("Failed to prepare task DTO: {}", e);
            Err(AppError::Internal)
        }
    }
}
