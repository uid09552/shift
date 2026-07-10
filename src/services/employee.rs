use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;
use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::EmployeeRepository;
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::TenantContext;

#[derive(Deserialize)]
pub struct PaginationQuery {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[derive(Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Deserialize)]
pub struct AddCapabilityRequest {
    pub capability_id: Uuid,
}

pub struct EmployeeService;

impl EmployeeService {
    pub async fn list_employees(
        tenant: TenantContext,
        Query(q): Query<PaginationQuery>,
        State(state): State<AppState>,
    ) -> Json<Value> {
        let limit = q.limit.map(|l| l as i64).or(Some(50));
        let offset = q.offset.map(|o| o as i64);

        // Retrieve paginated list of employees from repository
        let employees = state
            .employee_repo
            .list_employees(&tenant.0, limit, offset)
            .await
            .expect("Error loading employees: check if database migration for shifts.order column has been applied");

        // Get total count for pagination metadata
        let total = state
            .employee_repo
            .count_employees(&tenant.0)
            .await
            .expect("Error counting employees");

        let response = PaginatedResponse {
            data: employees,
            total,
            limit: limit.unwrap_or(50),
            offset: offset.unwrap_or(0),
        };
        Json(serde_json::to_value(response).unwrap())
    }

    pub async fn create_employee(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'name'".into()))?;

        let email = body
            .get("email")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'email'".into()))?;

        let monthly_working_hours = body
            .get("monthly_working_hours")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| AppError::Validation("Missing 'monthly_working_hours'".into()))?;

        let employee = state
            .employee_repo
            .create_employee(&tenant.0, name, email, monthly_working_hours)
            .await?;

        audit_log::record(&state, &tenant.0, actor.0, "employee.create", "employee", Some(employee.id.to_string()), Some(body.to_string())).await;

        Ok(Json(serde_json::to_value(employee).unwrap()))
    }

    pub async fn get_employee_by_id(
        Path(_employee_id): Path<Uuid>,
        State(_state): State<AppState>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn update_employee(
        tenant: TenantContext,
        actor: AuditActor,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        // Extract optional fields from request body
        let name_opt = body.get("name").and_then(|v| v.as_str());
        let email_opt = body.get("email").and_then(|v| v.as_str());
        let monthly_working_hours_opt = body.get("monthly_working_hours").and_then(|v| v.as_f64());

        // Retrieve existing employee
        let existing = state
            .employee_repo
            .get_employee(&tenant.0, employee_id)
            .await
            .expect("Error loading employee");

        match existing {
            Some(mut employee) => {
                // Update mutable fields if provided
                if let Some(name) = name_opt {
                    employee.name = name.to_string();
                }
                if let Some(email) = email_opt {
                    employee.email = email.to_string();
                }
                if let Some(monthly_working_hours) = monthly_working_hours_opt {
                    employee.monthly_working_hours = monthly_working_hours;
                }

                // Persist changes via repository
                state
                    .employee_repo
                    .update_employee(&tenant.0, employee.clone())
                    .await
                    .expect("Error updating employee");

                audit_log::record(&state, &tenant.0, actor.0, "employee.update", "employee", Some(employee_id.to_string()), Some(body.to_string())).await;

                Json(serde_json::to_value(employee).unwrap())
            }
            None => Json(serde_json::json!({ "error": "Employee not found" })),
        }
    }

    pub async fn get_employee_by_email(
        tenant: TenantContext,
        Path(email): Path<String>,
        State(state): State<AppState>,
    ) -> Json<Value> {
        // Retrieve employee by email using repository
        let employee_opt = state
            .employee_repo
            .get_employee_by_email(&tenant.0, &email)
            .await
            .expect("Error loading employee by email");
        match employee_opt {
            Some(employee) => Json(serde_json::to_value(employee).unwrap()),
            None => Json(serde_json::json!({ "error": "Employee not found" })),
        }
    }

    pub async fn get_employee_capabilities(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Json<Value> {
        let capabilities = state
            .employee_repo
            .get_employee_capabilities(&tenant.0, employee_id)
            .await
            .expect("Error loading employee capabilities");

        Json(serde_json::to_value(capabilities).unwrap())
    }

    pub async fn add_employee_capability(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<AddCapabilityRequest>,
    ) -> Json<Value> {
        state
            .employee_repo
            .add_employee_capability(&tenant.0, employee_id, body.capability_id)
            .await
            .expect("Error inserting employee capability");

        Json(serde_json::json!({ "message": "Capability added successfully" }))
    }

    pub async fn get_employee_available_shifts(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let shifts = state
            .employee_repo
            .get_employee_available_shifts(&tenant.0, employee_id)
            .await?;
        Ok(Json(serde_json::to_value(shifts).unwrap()))
    }

    pub async fn add_employee_available_shift(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let shift_id = body
            .get("shift_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'shift_id'".into()))?
            .parse::<Uuid>()
            .map_err(|_| AppError::Validation("Invalid 'shift_id' UUID".into()))?;

        state
            .employee_repo
            .add_employee_available_shift(&tenant.0, employee_id, shift_id)
            .await?;

        Ok(Json(serde_json::json!({ "message": "Available shift added successfully" })))
    }

    pub async fn delete_employee(
        tenant: TenantContext,
        actor: AuditActor,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .employee_repo
            .delete_employee(&tenant.0, employee_id)
            .await?;
        audit_log::record(&state, &tenant.0, actor.0, "employee.delete", "employee", Some(employee_id.to_string()), None).await;
        Ok(Json(serde_json::json!({ "message": "Employee deleted successfully" })))
    }
}
