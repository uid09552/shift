use axum::{
    middleware,
    response::Json,
    routing::{delete, get, patch, post, put},
    Router,
    extract::{ State},
    http::StatusCode,
};
use serde_json::json;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

use crate::repository::{AppState, domain::PlanningTaskRepository};
use crate::telemetry;
use crate::services::{
    analysis::AnalysisService,
    audit_log::AuditLogService,
    auth,
    capability::CapabilityService,
    confirmed_shift_plan::ConfirmedShiftPlanService,
    employee::EmployeeService,
    optimizer,
    planner_settings::PlannerSettingsService,
    shift::ShiftService,
    shift_assignment::ShiftAssignmentService,
    shift_wish::ShiftWishService,
    tenant,
    unavailability::UnavailabilityService,
    user_management::UserManagementService,
    wish_settings::WishSettingsService,
    workstation::WorkstationService,
    workstation_unavailability::WorkstationUnavailabilityService,
};

pub async fn health_check(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.pool.clone();

    let result = telemetry::db_blocking(move || {
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
        // Self (current user from OIDC token)
        .route("/self", get(auth::get_self))
        // Users of the caller's organization (Keycloak-backed, shift-admin only)
        .route(
            "/users",
            get(UserManagementService::list_users).post(UserManagementService::create_user),
        )
        .route("/users/:user_id", delete(UserManagementService::remove_user))
        .route("/users/:user_id/roles", put(UserManagementService::update_user_roles))
        // Employees
        .route("/employees", get(EmployeeService::list_employees).post(EmployeeService::create_employee))
        .route("/employees/template", get(EmployeeService::download_template))
        .route("/employees/import", post(EmployeeService::import_employees))
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
        .route("/shifts/template", get(ShiftService::download_template))
        .route("/shifts/import", post(ShiftService::import_shifts))
        .route("/shifts/:shift_id", get(ShiftService::get_shift_by_id).put(ShiftService::update_shift).delete(ShiftService::delete_shift))
        .route("/shifts/:shift_id/weekday-times", post(ShiftService::set_weekday_time))
        .route("/shifts/:shift_id/weekday-times/:weekday", delete(ShiftService::delete_weekday_time))
        // Capabilities
        .route("/capabilities", get(CapabilityService::list_capabilities).post(CapabilityService::create_capability))
        .route("/capabilities/template", get(CapabilityService::download_template))
        .route("/capabilities/import", post(CapabilityService::import_capabilities))
        .route("/capabilities/:capability_id", get(CapabilityService::get_capability_by_id).put(CapabilityService::update_capability).delete(CapabilityService::delete_capability))
        // Workstations
        .route("/workstations", get(WorkstationService::list_workstations).post(WorkstationService::create_workstation))
        .route("/workstations/template", get(WorkstationService::download_template))
        .route("/workstations/import", post(WorkstationService::import_workstations))
        .route(
            "/workstations/:workstation_id",
            get(WorkstationService::get_workstation_by_id).put(WorkstationService::update_workstation).delete(WorkstationService::delete_workstation),
        )
        .route(
            "/workstations/:workstation_id/availability",
            put(WorkstationService::set_workstation_availability),
        )
        .route(
            "/workstations/:workstation_id/enable",
            patch(WorkstationService::enable_workstation),
        )
        .route(
            "/workstations/:workstation_id/disable",
            patch(WorkstationService::disable_workstation),
        )
        .route(
            "/workstations/:workstation_id/required-capabilities",
            get(WorkstationService::get_workstation_required_capabilities).post(WorkstationService::add_workstation_required_capability),
        )
        .route(
            "/workstation-unavailabilities",
            get(WorkstationUnavailabilityService::list_all_workstation_unavailabilities),
        )
        .route(
            "/workstations/:workstation_id/unavailabilities",
            get(WorkstationUnavailabilityService::list_workstation_unavailabilities).post(WorkstationUnavailabilityService::create_workstation_unavailability),
        )
        .route(
            "/workstations/:workstation_id/unavailabilities/:unavailability_id",
            get(WorkstationUnavailabilityService::get_workstation_unavailability_by_id).delete(WorkstationUnavailabilityService::delete_workstation_unavailability),
        )
        // Unavailabilities
        .route("/unavailabilities", get(UnavailabilityService::list_unavailabilities).post(UnavailabilityService::create_unavailability))
        .route(
            "/unavailabilities/:unavailability_id",
            get(UnavailabilityService::get_unavailability_by_id).delete(UnavailabilityService::delete_unavailability),
        )
        // Shift Wishes
        .route("/shift-wishes", get(ShiftWishService::list_shift_wishes).post(ShiftWishService::create_shift_wish))
        .route(
            "/shift-wishes/:wish_id",
            get(ShiftWishService::get_shift_wish_by_id).delete(ShiftWishService::delete_shift_wish),
        )
        // Shift wish window (readable by everyone, writable by shift-admin only)
        .route(
            "/wish-settings",
            get(WishSettingsService::get_wish_settings).put(WishSettingsService::update_wish_settings),
        )
        // Planner
        .route("/planner/plan", post(optimizer::trigger_plan))
        .route("/planner/plan/:task_id/status", get(optimizer::get_plan_status))
        .route("/planner/prepare", post(optimizer::prepare))
        .route("/planner/tasks", get(optimizer::list_tasks))
        .route("/planner/tasks/:task_id", get(optimizer::get_task).delete(optimizer::delete_task))
        .route("/planner/optimized-shifts", get(optimizer::list_optimized_shifts))
        .route("/planner/optimized-shifts/:result_id", get(optimizer::get_optimized_shift).put(optimizer::update_optimized_shift).delete(optimizer::delete_optimized_shift))
        .route("/planner/optimized-shifts/:result_id/take-as-plan", post(optimizer::take_as_plan))
        .route(
            "/planner-settings",
            get(PlannerSettingsService::get_planner_settings).put(PlannerSettingsService::update_planner_settings),
        )
        // Shift Assignments
        .route(
            "/employees/:employee_id/shift-assignments",
            get(ShiftAssignmentService::get_employee_shift_assignments).post(ShiftAssignmentService::create_shift_assignment),
        )
        .route(
            "/shift-assignments/import",
            post(ShiftAssignmentService::import_shift_assignments),
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
        )
        .route(
            "/analysis/staffing-per-day",
            get(AnalysisService::get_staffing_per_day),
        )
        // Audit Logs
        .route("/audit-logs", get(AuditLogService::list_audit_logs))
        // What is running — version, commit, build date
        .route("/info", get(crate::services::info::get_info))
        // Resolve the request's tenant and roles from the x-access-token JWT (or the
        // default tenant and full access in dev mode) before any handler runs, and
        // reject methods the caller's roles do not cover.
        .layer(middleware::from_fn_with_state(state.clone(), tenant::authenticate));

    Router::new()
        .route("/health", get(health_check))
        .nest("/api/v1", api_v1)
        .layer(CorsLayer::permissive())
        // Applied last, so it wraps CORS and auth and sees every request and
        // its final status. No-op unless an OTLP endpoint is configured.
        .layer(middleware::from_fn(telemetry::http_trace_layer))
        .with_state(state)
}

pub async fn start_server(state: AppState, addr: SocketAddr) -> std::io::Result<()> {
    // Mark tasks stuck in 'scheduled' for more than 3 hours as failed
    let cutoff = chrono::Utc::now().naive_utc() - chrono::Duration::hours(3);
    match state.planning_task_repo.mark_stale_tasks_failed(cutoff).await {
        Ok(n) if n > 0 => println!("Marked {} stale task(s) as failed on startup", n),
        Ok(_) => {}
        Err(e) => eprintln!("Failed to cleanup stale tasks on startup: {}", e),
    }
    optimizer::start_result_subscriber(state.clone());
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Server listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}