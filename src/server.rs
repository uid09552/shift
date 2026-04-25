use axum::{
    response::Json,
    routing::{get, patch},
    Router,
};
use serde_json::json;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

use crate::database::DbPool;
use crate::services::{
    capability::CapabilityService,
    employee::EmployeeService,
    shift::ShiftService,
    unavailability::UnavailabilityService,
    workstation::WorkstationService,
};

pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

pub fn create_router(pool: DbPool) -> Router {
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
        );

    Router::new()
        .route("/health", get(health_check))
        .nest("/api/v1", api_v1)
        .layer(CorsLayer::permissive())
        .with_state(pool)
}

pub async fn start_server(pool: DbPool, addr: SocketAddr) -> std::io::Result<()> {
    let app = create_router(pool);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Server listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}