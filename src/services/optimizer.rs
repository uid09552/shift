use futures_util::StreamExt;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Json, Response},
};
use chrono::{Local, NaiveDate, Utc};
use crate::broker::JetStreamStatus;
use crate::errors::AppError;
use crate::models::{ConstraintTask, PlanningPeriod, ShiftTask, ShiftWeekdayTimeTask, TaskDTO, TaskResultDto, EmployeeTask, WorkstationTask, WorkstationUnavailabilityRange, CapabilityTask, PreferredOffTask, ShiftWishTask};
use crate::repository::{AppState, domain::*};
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::TenantContext;
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

#[derive(Deserialize, Serialize)]
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
        tenant_id: &str,
        employee_filter: Option<&[Uuid]>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        constraints: Option<ConstraintTask>,
    ) -> Result<TaskDTO, Box<dyn std::error::Error + Send + Sync>> {
        let shifts = state.shift_repo.list_shifts(tenant_id).await?;

        let employees = if let Some(ids) = employee_filter {
            if ids.is_empty() {
                state.employee_repo.list_employees(tenant_id, None, None).await?
            } else {
                state.employee_repo.list_employees_by_ids(tenant_id, ids).await?
            }
        } else {
            state.employee_repo.list_employees(tenant_id, None, None).await?
        };

        let workstations = state.workstation_repo.list_workstations(tenant_id).await?;

        let all_unavailabilities = state.unavailability_repo.list_unavailabilities(tenant_id).await?;
        let mut unavail_map: std::collections::HashMap<Uuid, Vec<String>> = std::collections::HashMap::new();
        let mut preferred_off_map: std::collections::HashMap<Uuid, Vec<PreferredOffTask>> = std::collections::HashMap::new();
        for u in all_unavailabilities {
            if u.is_soft_preference {
                preferred_off_map.entry(u.employee_id).or_default().push(PreferredOffTask {
                    date: u.unavailable_date.to_string(),
                    shift_id: u.shift_id.map(|id| id.to_string()),
                });
            } else {
                unavail_map.entry(u.employee_id).or_default().push(u.unavailable_date.to_string());
            }
        }

        let all_wishes = state.shift_wish_repo.list_shift_wishes(tenant_id).await?;
        let mut wish_map: std::collections::HashMap<Uuid, Vec<ShiftWishTask>> = std::collections::HashMap::new();
        for w in all_wishes {
            wish_map.entry(w.employee_id).or_default().push(ShiftWishTask {
                date: w.wish_date.to_string(),
                shift_id: w.shift_id.to_string(),
            });
        }

        // NOTE: employee skills / workstation required_skills are matched by
        // capability *name* (see employee_tasks/workstation_tasks below), not
        // UUID — so the catalog entry's `id` here must also be the name for the
        // optimizer's skill-downgrade lookup to line up with those lists.
        let capability_tasks: Vec<CapabilityTask> = state.capability_repo.list_capabilities(tenant_id).await?
            .into_iter()
            .map(|c| CapabilityTask { id: c.name, level: c.level, skill_group: c.skill_group })
            .collect();

        let all_ws_unavailabilities = state.workstation_unavailability_repo.list_workstation_unavailabilities(tenant_id).await?;
        let mut ws_unavail_map: std::collections::HashMap<Uuid, Vec<WorkstationUnavailabilityRange>> = std::collections::HashMap::new();
        for u in all_ws_unavailabilities {
            ws_unavail_map.entry(u.workstation_id).or_default().push(WorkstationUnavailabilityRange {
                from_date: u.unavailable_from.to_string(),
                to_date: u.unavailable_to.to_string(),
            });
        }

        let shift_tasks = Self::build_shift_tasks(shifts);

        let total_workstations = workstations.len();
        let workstation_tasks: Vec<WorkstationTask> = workstations.into_iter()
            .filter(|ws| ws.available && !ws.active_shift_ids.is_empty())
            .map(|ws| {
                let unavailability = ws_unavail_map.get(&ws.id).cloned().unwrap_or_default();
                WorkstationTask {
                    id: ws.id.to_string(),
                    name: ws.name,
                    required_skills: ws.required_capabilities.iter().map(|c| c.name.clone()).collect(),
                    priority: ws.priority.clone(),
                    operating_shifts: ws.active_shift_ids.iter().map(|id| id.to_string()).collect(),
                    min_employees: ws.min_employees,
                    max_employees: ws.max_employees,
                    unavailability,
                }
            }).collect();

        let employee_tasks: Vec<EmployeeTask> = employees.into_iter()
            .map(|emp| {
                let unavailability = unavail_map.get(&emp.id).cloned().unwrap_or_default();
                let preferred_off = preferred_off_map.get(&emp.id).cloned().unwrap_or_default();
                let wishes = wish_map.get(&emp.id).cloned().unwrap_or_default();
                EmployeeTask {
                    id: emp.id.to_string(),
                    name: emp.name,
                    skills: emp.capabilities.iter().map(|c| c.name.clone()).collect(),
                    available_shifts: emp.available_shifts.iter().map(|s| s.id.to_string()).collect(),
                    unavailability,
                    monthly_working_hours: emp.monthly_working_hours,
                    preferred_off,
                    wishes,
                }
            }).collect();

        if workstation_tasks.is_empty() {
            return Err(format!(
                "No schedulable workstations ({} total — all are disabled or have no active shifts assigned).",
                total_workstations
            ).into());
        }
        if employee_tasks.is_empty() {
            return Err(
                "No employees found. Add at least one employee before running the optimizer.".into()
            );
        }

        eprintln!(
            "Optimizer payload: {} workstations ({} skipped), {} employees",
            workstation_tasks.len(), total_workstations - workstation_tasks.len(),
            employee_tasks.len(),
        );

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
            capabilities: capability_tasks,
            constraints,
        })
    }

    fn build_shift_tasks(shifts: Vec<Shift>) -> Vec<ShiftTask> {
        shifts.into_iter().map(|shift| {
            let weekday_times = shift.weekday_times.iter().map(|wt| ShiftWeekdayTimeTask {
                weekday: wt.weekday.to_string(),
                start_time: wt.start_time.to_string(),
                end_time: wt.end_time.to_string(),
                min_employees: wt.min_employees,
                max_employees: wt.max_employees,
                free_days_after_shift: wt.free_days_after_shift,
            }).collect();
            ShiftTask {
                id: shift.id.to_string(),
                name: shift.name,
                is_night_shift: false,
                weekday_times,
            }
        }).collect()
    }

    /// Build task DTO, store it in the DB, publish to NATS, return the task_id.
    #[tracing::instrument(
        name = "publish scheduling",
        skip_all,
        fields(
            otel.kind = "producer",
            messaging.system = "nats",
            messaging.destination.name = NATS_SCHEDULING_SUBJECT,
            messaging.message.id = %task_id,
        )
    )]
    pub async fn schedule(
        &self,
        tenant_id: &str,
        task_id: Uuid,
        employee_filter: Option<&[Uuid]>,
        start_date: Option<&str>,
        end_date: Option<&str>,
        constraints: Option<ConstraintTask>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let nats_client = self.state.nats_client.as_ref()
            .ok_or("NATS client not configured")?;

        let task_dto = Self::build_task_dto(&self.state, tenant_id, employee_filter, start_date, end_date, constraints).await?;

        // Wrap with job_id so the Python can echo it back
        let mut payload_value = serde_json::to_value(&task_dto)?;
        if let serde_json::Value::Object(ref mut map) = payload_value {
            map.insert("job_id".to_string(), serde_json::Value::String(task_id.to_string()));
            // NATS carries no headers here, so the trace context rides along in
            // the payload: the planner picks it up and its solve shows up under
            // the request that asked for the plan.
            if let Some(traceparent) = crate::telemetry::current_traceparent() {
                map.insert("traceparent".to_string(), serde_json::Value::String(traceparent));
            }
        }
        let payload_bytes = serde_json::to_vec(&payload_value)?;

        // Store task in DB
        self.state.planning_task_repo.create_planning_task(tenant_id, task_id, payload_value).await?;

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
        crate::telemetry::metrics().messaging_published.add(
            1,
            &[opentelemetry::KeyValue::new(
                "messaging.destination.name",
                NATS_SCHEDULING_SUBJECT,
            )],
        );

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

#[tracing::instrument(
    name = "consume scheduling.results",
    skip_all,
    fields(
        otel.kind = "consumer",
        messaging.system = "nats",
        messaging.destination.name = NATS_RESULTS_SUBJECT,
    )
)]
async fn handle_result_message(
    state: AppState,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let raw: serde_json::Value = serde_json::from_slice(payload)?;

    // Continue the trace the planner ran the solve in, so storing the result
    // shows up under the plan request rather than as a trace of its own.
    {
        use tracing_opentelemetry::OpenTelemetrySpanExt;
        // Fails only when telemetry is off and the OTel layer isn't installed.
        let _ = tracing::Span::current().set_parent(crate::telemetry::context_from_traceparent(
            raw.get("traceparent").and_then(|v| v.as_str()),
        ));
    }
    crate::telemetry::metrics().messaging_consumed.add(
        1,
        &[opentelemetry::KeyValue::new(
            "messaging.destination.name",
            NATS_RESULTS_SUBJECT,
        )],
    );

    // job_id may be absent on old/legacy messages — skip silently
    let Some(job_id_str) = raw.get("job_id").and_then(|v| v.as_str()) else {
        eprintln!("Result message missing job_id — skipping (raw: {})", &raw.to_string()[..200.min(raw.to_string().len())]);
        return Ok(());
    };
    let job_id: Uuid = job_id_str.parse()?;

    // Background jobs have no request/token to resolve a tenant from, so they're
    // scoped to the server's configured tenant (see TenantContext for the HTTP-side equivalent).
    let tenant_id = state.default_tenant_id.as_str();

    // Check status field for errors from optimizer
    let opt_status = raw.get("status").and_then(|v| v.as_str()).unwrap_or("unknown");
    if opt_status == "error" || opt_status == "validation_error" {
        let msg = raw.get("message").and_then(|v| v.as_str()).unwrap_or("optimizer error").to_string();
        eprintln!("Optimizer reported error for task {}: {}", job_id, msg);
        state.planning_task_repo.update_planning_task_error(tenant_id, job_id, msg).await?;
        return Ok(());
    }

    // Deserialize the result, store it, update task
    let result_dto: TaskResultDto = serde_json::from_value(raw.clone())?;
    let result_json = serde_json::to_value(&result_dto)?;
    let stored = state.optimized_shift_result_repo.create_optimized_shift_result(tenant_id, result_json).await?;
    state.planning_task_repo.update_planning_task_done(tenant_id, job_id, stored.id).await?;
    println!("Task {} done — result stored as {}", job_id, stored.id);

    Ok(())
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

/// Builds the optimizer's constraint payload from the tenant's stored planner
/// settings, letting a per-request `monthly_hours_target_weight` override the
/// stored value. Falls back to the optimizer's own built-in defaults (an empty
/// `ConstraintTask`) if the settings can't be loaded.
async fn build_constraints(
    state: &AppState,
    tenant_id: &str,
    monthly_hours_target_weight_override: Option<u64>,
) -> ConstraintTask {
    match state.planner_settings_repo.get_or_create_planner_settings(tenant_id).await {
        Ok(s) => {
            let mut priority_weights = std::collections::HashMap::new();
            priority_weights.insert("high".to_string(), s.priority_weight_high);
            priority_weights.insert("medium".to_string(), s.priority_weight_medium);
            priority_weights.insert("low".to_string(), s.priority_weight_low);
            ConstraintTask {
                monthly_hours_target_weight: monthly_hours_target_weight_override
                    .or(Some(s.monthly_hours_target_weight as u64)),
                night_shift_recovery_days: Some(s.night_shift_recovery_days),
                min_rest_hours: Some(s.min_rest_hours),
                max_consecutive_days: Some(s.max_consecutive_days),
                max_working_days_per_week: Some(s.max_working_days_per_week),
                equality_weight: Some(s.equality_weight),
                priority_weights: Some(priority_weights),
                solver_time_limit_seconds: Some(s.solver_time_limit_seconds),
                solver_num_workers: Some(s.solver_num_workers),
                weekly_min_hours: s.weekly_min_hours,
                weekly_max_hours: s.weekly_max_hours,
                weekly_hours_target_weight: Some(s.weekly_hours_target_weight),
                preference_weight: Some(s.preference_weight),
                skill_downgrade_weight: Some(s.skill_downgrade_weight),
                fatigue_weight: Some(s.fatigue_weight),
                night_shift_fatigue_multiplier: Some(s.night_shift_fatigue_multiplier),
                shift_continuity_weight: Some(s.shift_continuity_weight),
                shift_continuity_week_bonus: Some(s.shift_continuity_week_bonus),
                wish_weight: Some(s.wish_weight),
            }
        }
        Err(e) => {
            eprintln!("Failed to load planner settings for tenant {}: {} — using optimizer defaults", tenant_id, e);
            ConstraintTask {
                monthly_hours_target_weight: monthly_hours_target_weight_override,
                ..Default::default()
            }
        }
    }
}

pub async fn trigger_plan(
    tenant: TenantContext,
    actor: AuditActor,
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
    let constraints = Some(build_constraints(&state, &tenant.0, request.monthly_hours_target_weight).await);

    let svc = OptimizerService::new(state.clone());
    if let Err(e) = svc.schedule(
        &tenant.0,
        task_id,
        employee_ids.as_deref(),
        start_date.as_deref(),
        end_date.as_deref(),
        constraints,
    ).await {
        let msg = e.to_string();
        eprintln!("Failed to schedule task {}: {}", task_id, msg);
        return Err(AppError::Validation(msg));
    }

    let changes = serde_json::to_string(&request).unwrap_or_default();
    audit_log::record(&state, &tenant.0, actor.0, "planner.optimize", "planning_task", Some(task_id.to_string()), Some(changes)).await;

    Ok(Json(PlanTaskResponse { task_id }))
}

pub async fn get_plan_status(
    tenant: TenantContext,
    Path(task_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<PlanTaskStatusResponse>, AppError> {
    let task = state.planning_task_repo.get_planning_task(&tenant.0, task_id).await
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

pub async fn list_tasks(tenant: TenantContext, State(state): State<AppState>) -> Result<Json<ListTasksResponse>, AppError> {
    let tasks = state.planning_task_repo.list_planning_tasks(&tenant.0).await
        .map_err(|e| { eprintln!("Failed to list tasks: {}", e); AppError::Internal })?;
    let count = tasks.len();
    Ok(Json(ListTasksResponse {
        tasks: tasks.into_iter().map(PlanningTaskResponse::from).collect(),
        count,
    }))
}

pub async fn get_task(
    tenant: TenantContext,
    Path(task_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let task = state.planning_task_repo.get_planning_task(&tenant.0, task_id).await
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
    tenant: TenantContext,
    Query(q): Query<ListOptimizedShiftResultsQuery>,
    State(state): State<AppState>,
) -> Result<Json<PaginatedOptimizedShiftResultsResponse>, AppError> {
    if q.latest.unwrap_or(false) {
        let latest = state.optimized_shift_result_repo.get_latest_optimized_shift_result(&tenant.0).await
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
    let results = state.optimized_shift_result_repo.list_optimized_shift_results(&tenant.0, limit, offset).await
        .map_err(|e| { eprintln!("Failed to list optimized shift results: {}", e); AppError::Internal })?;
    let total = state.optimized_shift_result_repo.count_optimized_shift_results(&tenant.0).await
        .map_err(|e| { eprintln!("Failed to count optimized shift results: {}", e); AppError::Internal })?;
    let data: Vec<OptimizedShiftResultResponse> = results.into_iter().filter_map(|r| {
        let result_dto: TaskResultDto = serde_json::from_value(r.result.clone()).ok()?;
        Some(OptimizedShiftResultResponse { id: r.id, result: result_dto, creation_date: r.creation_date })
    }).collect();
    Ok(Json(PaginatedOptimizedShiftResultsResponse { data, total, limit: limit.unwrap_or(50), offset: offset.unwrap_or(0) }))
}

pub async fn get_optimized_shift(
    tenant: TenantContext,
    Path(result_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<OptimizedShiftResultResponse>, AppError> {
    let stored = state.optimized_shift_result_repo.get_optimized_shift_result_by_id(&tenant.0, result_id).await
        .map_err(|e| { eprintln!("Failed to get optimized shift result: {}", e); AppError::Internal })?
        .ok_or(AppError::NotFound)?;
    let result_dto: TaskResultDto = serde_json::from_value(stored.result)
        .map_err(|e| { eprintln!("Failed to deserialize stored result: {}", e); AppError::Internal })?;
    Ok(Json(OptimizedShiftResultResponse { id: stored.id, result: result_dto, creation_date: stored.creation_date }))
}

pub async fn delete_task(
    tenant: TenantContext,
    Path(task_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<StatusCode, AppError> {
    state.planning_task_repo.delete_planning_task(&tenant.0, task_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_optimized_shift(
    tenant: TenantContext,
    Path(result_id): Path<Uuid>,
    State(state): State<AppState>,
    Json(request): Json<TaskResultDto>,
) -> Result<Json<OptimizedShiftResultResponse>, AppError> {
    let result_json = serde_json::to_value(&request).map_err(|_| AppError::Internal)?;
    let updated = state.optimized_shift_result_repo
        .update_optimized_shift_result(&tenant.0, result_id, result_json).await
        .map_err(|e| { eprintln!("Failed to update optimized shift result: {}", e); e })?;
    Ok(Json(OptimizedShiftResultResponse { id: updated.id, result: request, creation_date: updated.creation_date }))
}

#[derive(Deserialize)]
pub struct TakeAsPlanRequest {
    pub employee_ids: Option<Vec<Uuid>>,
}

#[derive(Serialize)]
pub struct TakeAsPlanResponse {
    pub employee_count: usize,
    pub created: usize,
}

/// POST /planner/optimized-shifts/:result_id/take-as-plan
/// Overwrites the confirmed shift plans for the result's planning period (optionally
/// scoped to a subset of employees) with the assignments/free days from this optimized
/// result. Runs entirely server-side in one transaction, replacing what used to be a
/// per-employee load + per-entry delete/create sequence of API calls from the UI.
pub async fn take_as_plan(
    tenant: TenantContext,
    actor: AuditActor,
    Path(result_id): Path<Uuid>,
    State(state): State<AppState>,
    Json(request): Json<TakeAsPlanRequest>,
) -> Result<Json<TakeAsPlanResponse>, AppError> {
    let stored = state.optimized_shift_result_repo.get_optimized_shift_result_by_id(&tenant.0, result_id).await?
        .ok_or(AppError::NotFound)?;
    let result: TaskResultDto = serde_json::from_value(stored.result)
        .map_err(|_| AppError::Internal)?;

    let filter_ids: Option<Vec<String>> = request.employee_ids
        .filter(|ids| !ids.is_empty())
        .map(|ids| ids.iter().map(|id| id.to_string()).collect());

    let plans: Vec<_> = match &filter_ids {
        Some(ids) => result.employee_plans.into_iter().filter(|ep| ids.contains(&ep.employee_id)).collect(),
        None => result.employee_plans,
    };
    if plans.is_empty() {
        return Err(AppError::Validation("No employee plans found for the given selection".into()));
    }

    let from_date = NaiveDate::parse_from_str(&result.planning_period.start_date, "%Y-%m-%d")
        .map_err(|_| AppError::Internal)?;
    let to_date = NaiveDate::parse_from_str(&result.planning_period.end_date, "%Y-%m-%d")
        .map_err(|_| AppError::Internal)?;

    let now = Utc::now().naive_utc();
    let mut employee_ids: Vec<Uuid> = Vec::new();
    let mut new_plans: Vec<ConfirmedShiftPlan> = Vec::new();

    for ep in &plans {
        let Ok(employee_id) = ep.employee_id.parse::<Uuid>() else { continue };
        employee_ids.push(employee_id);

        for entry in &ep.daily_plan {
            let Ok(date) = NaiveDate::parse_from_str(&entry.date, "%Y-%m-%d") else { continue };
            match entry.status.as_str() {
                "assigned" => {
                    let Some(shift_id) = entry.shift_id.as_ref().and_then(|s| s.parse::<Uuid>().ok()) else { continue };
                    let workstation_id = entry.workstation_id.as_ref().and_then(|s| s.parse::<Uuid>().ok());
                    new_plans.push(ConfirmedShiftPlan {
                        id: Uuid::new_v4(),
                        employee_id,
                        shift_id: Some(shift_id),
                        workstation_id,
                        date,
                        is_present: true,
                        absence_type: None,
                        creation_type: "automated".to_string(),
                        created_at: now,
                        updated_at: now,
                    });
                }
                "free" => {
                    new_plans.push(ConfirmedShiftPlan {
                        id: Uuid::new_v4(),
                        employee_id,
                        shift_id: None,
                        workstation_id: None,
                        date,
                        is_present: false,
                        absence_type: Some("free".to_string()),
                        creation_type: "automated".to_string(),
                        created_at: now,
                        updated_at: now,
                    });
                }
                _ => {}
            }
        }
    }

    let created = state.confirmed_shift_plan_repo
        .replace_confirmed_shift_plans_for_period(&tenant.0, &employee_ids, from_date, to_date, new_plans)
        .await?;

    let response = TakeAsPlanResponse { employee_count: employee_ids.len(), created: created.len() };
    let changes = serde_json::to_string(&response).unwrap_or_default();
    audit_log::record(&state, &tenant.0, actor.0, "planner.take_as_plan", "confirmed_shift_plan", Some(result_id.to_string()), Some(changes)).await;

    Ok(Json(response))
}

pub async fn delete_optimized_shift(
    tenant: TenantContext,
    Path(result_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<StatusCode, AppError> {
    // Clear the result reference from any task that points to this result first,
    // so that after deletion the task list no longer shows stale View/Delete buttons.
    state.planning_task_repo.clear_task_result_id(&tenant.0, result_id).await
        .map_err(|e| { eprintln!("Failed to clear task result_id: {}", e); AppError::Internal })?;

    state.optimized_shift_result_repo.delete_optimized_shift_result(&tenant.0, result_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn prepare(
    tenant: TenantContext,
    State(state): State<AppState>,
    Json(request): Json<PlanRequest>,
) -> Result<Json<TaskDTO>, AppError> {
    let employee_filter = request.employee_ids.as_deref();
    let constraints = Some(build_constraints(&state, &tenant.0, request.monthly_hours_target_weight).await);
    match OptimizerService::build_task_dto(&state, &tenant.0, employee_filter, request.start_date.as_deref(), request.end_date.as_deref(), constraints).await {
        Ok(task_dto) => Ok(Json(task_dto)),
        Err(e) => {
            eprintln!("Failed to prepare task DTO: {}", e);
            Err(AppError::Internal)
        }
    }
}
