use axum::{
    response::Json,
    routing::{delete, get, post, put},
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
    analysis::AnalysisService,
    capability::CapabilityService,
    confirmed_shift_plan::ConfirmedShiftPlanService,
    employee::EmployeeService,
    optimizer,
    shift::ShiftService,
    shift_assignment::ShiftAssignmentService,
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
        .route("/employees/:employee_id", get(EmployeeService::get_employee_by_id).put(EmployeeService::update_employee).delete(EmployeeService::delete_employee))
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
        .route("/shifts/:shift_id", get(ShiftService::get_shift_by_id).put(ShiftService::update_shift).delete(ShiftService::delete_shift))
        .route("/shifts/:shift_id/weekday-times", post(ShiftService::set_weekday_time))
        .route("/shifts/:shift_id/weekday-times/:weekday", delete(ShiftService::delete_weekday_time))
        // Capabilities
        .route("/capabilities", get(CapabilityService::list_capabilities).post(CapabilityService::create_capability))
        .route("/capabilities/:capability_id", get(CapabilityService::get_capability_by_id).delete(CapabilityService::delete_capability))
        // Workstations
        .route("/workstations", get(WorkstationService::list_workstations).post(WorkstationService::create_workstation))
        .route(
            "/workstations/:workstation_id",
            get(WorkstationService::get_workstation_by_id).put(WorkstationService::update_workstation).delete(WorkstationService::delete_workstation),
        )
        .route(
            "/workstations/:workstation_id/availability",
            put(WorkstationService::set_workstation_availability),
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
        .route("/planner/plan", post(optimizer::trigger_plan))
        .route("/planner/prepare", get(optimizer::prepare))
        .route("/planner/tasks", get(optimizer::list_tasks).delete(optimizer::delete_all_tasks))
        .route("/planner/tasks/:task_id", get(optimizer::get_task))
        .route("/planner/optimized-shifts", get(optimizer::list_optimized_shifts))
        .route("/planner/optimized-shifts/:result_id", get(optimizer::get_optimized_shift).delete(optimizer::delete_optimized_shift))
        // Shift Assignments
        .route(
            "/employees/:employee_id/shift-assignments",
            get(ShiftAssignmentService::get_employee_shift_assignments).post(ShiftAssignmentService::create_shift_assignment),
        )
        .route(
            "/shift-assignments/:assignment_id",
            delete(ShiftAssignmentService::delete_shift_assignment),
        )
        // Confirmed Shift Plans
        .route(
            "/confirmed-shift-plans",
            get(ConfirmedShiftPlanService::list_confirmed_shift_plans),
        )
        .route(
            "/confirmed-shift-plans/:plan_id",
            get(ConfirmedShiftPlanService::get_confirmed_shift_plan_by_id).put(ConfirmedShiftPlanService::update_confirmed_shift_plan).delete(ConfirmedShiftPlanService::delete_confirmed_shift_plan),
        )
        .route(
            "/employees/:employee_id/confirmed-shift-plans",
            get(ConfirmedShiftPlanService::get_employee_confirmed_shift_plans).post(ConfirmedShiftPlanService::create_confirmed_shift_plan),
        )
        // Analysis
        .route(
            "/analysis/planned-hours-per-day-per-workstation",
            get(AnalysisService::get_planned_hours_per_day_per_workstation),
        )
        .route(
            "/analysis/planned-employees-per-day-per-workstation",
            get(AnalysisService::get_planned_employees_per_day_per_workstation),
        );

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