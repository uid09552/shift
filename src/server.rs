use axum::{
    response::Json,
    routing::{delete, get, patch, post},
    Router,
    extract::{ State},
    http::StatusCode,
};
use tokio::task;

use serde_json::json;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

use crate::repository::AppState;
use crate::services::{
    capability::CapabilityService,
    employee::EmployeeService,
    planner::PlannerService,
    shift::ShiftService,
    unavailability::UnavailabilityService,
    workstation::WorkstationService,
};

pub async fn health_check(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.pool.clone();

    let result = task::spawn_blocking(move || {
        pool.get().is_ok()
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result {
        Ok(Json(json!({ "status": "ok" })))
    } else {
        Err(StatusCode::SERVICE_UNAVAILABLE)
    }
}

pub fn create_router(state: AppState) -> Router {
    let api_v1 = Router::new()
        // Employees
        .route("/employees", get(EmployeeService::list_employees).post(EmployeeService::create_employee))
        .route("/employees/:employee_id", get(EmployeeService::get_employee_by_id).put(EmployeeService::update_employee))
        .route("/employees/email/:email", get(EmployeeService::get_employee_by_email))
        .route(
            "/employees/:employee_id/capabilities",
            get(EmployeeService::get_employee_capabilities).post(EmployeeService::add_employee_capability),
        )
        .route(
            "/employees/:employee_id/available-shifts",
            get(EmployeeService::get_employee_available_shifts).post(EmployeeService::add_employee_available_shift),
        )
        // Shifts
        .route("/shifts", get(ShiftService::list_shifts).post(ShiftService::create_shift))
        .route("/shifts/:shift_id", get(ShiftService::get_shift_by_id))
        .route("/shifts/:shift_id/weekday-times", post(ShiftService::set_weekday_time))
        .route("/shifts/:shift_id/weekday-times/:weekday", delete(ShiftService::delete_weekday_time))
        // Capabilities
        .route("/capabilities", get(CapabilityService::list_capabilities).post(CapabilityService::create_capability))
        .route("/capabilities/:capability_id", get(CapabilityService::get_capability_by_id))
        // Workstations
        .route("/workstations", get(WorkstationService::list_workstations).post(WorkstationService::create_workstation))
        .route(
            "/workstations/:workstation_id",
            get(WorkstationService::get_workstation_by_id).put(WorkstationService::update_workstation),
        )
        .route(
            "/workstations/:workstation_id/availability",
            patch(WorkstationService::set_workstation_availability),
        )
        .route(
            "/workstations/:workstation_id/required-capabilities",
            get(WorkstationService::get_workstation_required_capabilities).post(WorkstationService::add_workstation_required_capability),
        )
        // Unavailabilities
        .route("/unavailabilities", get(UnavailabilityService::list_unavailabilities).post(UnavailabilityService::create_unavailability))
        .route(
            "/unavailabilities/:unavailability_id",
            get(UnavailabilityService::get_unavailability_by_id).delete(UnavailabilityService::delete_unavailability),
        )
        // Planner
        .route("/planner/plan", post(PlannerService::trigger_plan))
        .route("/planner/prepare", get(PlannerService::prepare))
        .route("/planner/tasks", get(PlannerService::list_tasks).delete(PlannerService::delete_all_tasks))
        .route("/planner/tasks/:task_id", get(PlannerService::get_task));

    Router::new()
        .route("/health", get(health_check))
        .nest("/api/v1", api_v1)
        .layer(CorsLayer::permissive())
        .with_state(state)
}

pub async fn start_server(state: AppState, addr: SocketAddr) -> std::io::Result<()> {
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Server listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}