use axum::{
    extract::{Multipart, Path, Query, State},
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;
use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::{
    effective_weekly_hours, CapabilityRepository, Employee, EmployeeRepository, PlannerSettingsRepository,
    ShiftRepository,
};
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::TenantContext;
use crate::services::xlsx_io::{self, ImportResult};

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

/// The template's hours column, and the names it had before hours became weekly.
const HOURS_COLUMN: &str = "weekly_working_hours";
const OLD_HOURS_COLUMNS: [&str; 2] = ["max_working_hours", "monthly_working_hours"];

/// Most hours a week can hold.
const MAX_WEEKLY_HOURS: f64 = 168.0;

/// The tenant's default weekly hours, for everyone without their own.
async fn default_weekly_hours(state: &AppState, tenant: &TenantContext) -> Result<f64, AppError> {
    Ok(state
        .planner_settings_repo
        .get_or_create_planner_settings(&tenant.0)
        .await?
        .default_weekly_working_hours)
}

/// An employee as the API returns it: their own `weekly_working_hours` (null when
/// following the default) and the `effective_weekly_working_hours` they are held to.
fn employee_json(employee: &Employee, default_weekly: f64) -> Value {
    let mut value = serde_json::to_value(employee).unwrap();
    value["effective_weekly_working_hours"] =
        serde_json::json!(effective_weekly_hours(employee.weekly_working_hours, default_weekly));
    value
}

/// `weekly_working_hours` from a request body: `None` when the key is absent,
/// `Some(None)` for `null` (follow the default), `Some(Some(h))` for an own value.
/// A body still using `monthly_working_hours` is refused rather than half-applied.
fn weekly_hours_from_body(body: &Value) -> Result<Option<Option<f64>>, AppError> {
    if body.get("monthly_working_hours").is_some() {
        return Err(AppError::Validation(
            "'monthly_working_hours' is no longer supported; send 'weekly_working_hours' (hours per week, or null for the default)".into(),
        ));
    }
    match body.get(HOURS_COLUMN) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(v) => {
            let hours = v
                .as_f64()
                .ok_or_else(|| AppError::Validation("'weekly_working_hours' must be a number or null".into()))?;
            validate_weekly_hours(hours)?;
            Ok(Some(Some(hours)))
        }
    }
}

fn validate_weekly_hours(hours: f64) -> Result<(), AppError> {
    if (0.0..=MAX_WEEKLY_HOURS).contains(&hours) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "'weekly_working_hours' must be between 0 and {MAX_WEEKLY_HOURS}"
        )))
    }
}

impl EmployeeService {
    pub async fn list_employees(
        tenant: TenantContext,
        Query(q): Query<PaginationQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
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

        let default_weekly = default_weekly_hours(&state, &tenant).await?;
        let response = PaginatedResponse {
            data: employees.iter().map(|e| employee_json(e, default_weekly)).collect::<Vec<_>>(),
            total,
            limit: limit.unwrap_or(50),
            offset: offset.unwrap_or(0),
        };
        Ok(Json(serde_json::to_value(response).unwrap()))
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

        let weekly_working_hours = weekly_hours_from_body(&body)?.flatten();

        let employee = state
            .employee_repo
            .create_employee(&tenant.0, name, email, weekly_working_hours)
            .await?;

        audit_log::record(&state, &tenant.0, actor.0, "employee.create", "employee", Some(employee.id.to_string()), Some(body.to_string())).await;

        let default_weekly = default_weekly_hours(&state, &tenant).await?;
        Ok(Json(employee_json(&employee, default_weekly)))
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
    ) -> Result<Json<Value>, AppError> {
        // Extract optional fields from request body
        let name_opt = body.get("name").and_then(|v| v.as_str());
        let email_opt = body.get("email").and_then(|v| v.as_str());
        let weekly_working_hours_opt = weekly_hours_from_body(&body)?;

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
                // Absent: unchanged. null: back to the tenant default.
                if let Some(weekly_working_hours) = weekly_working_hours_opt {
                    employee.weekly_working_hours = weekly_working_hours;
                }

                // Persist changes via repository
                state
                    .employee_repo
                    .update_employee(&tenant.0, employee.clone())
                    .await
                    .expect("Error updating employee");

                audit_log::record(&state, &tenant.0, actor.0, "employee.update", "employee", Some(employee_id.to_string()), Some(body.to_string())).await;

                let default_weekly = default_weekly_hours(&state, &tenant).await?;
                Ok(Json(employee_json(&employee, default_weekly)))
            }
            None => Ok(Json(serde_json::json!({ "error": "Employee not found" }))),
        }
    }

    pub async fn get_employee_by_email(
        tenant: TenantContext,
        Path(email): Path<String>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        // Retrieve employee by email using repository
        let employee_opt = state
            .employee_repo
            .get_employee_by_email(&tenant.0, &email)
            .await
            .expect("Error loading employee by email");
        match employee_opt {
            Some(employee) => {
                let default_weekly = default_weekly_hours(&state, &tenant).await?;
                Ok(Json(employee_json(&employee, default_weekly)))
            }
            None => Ok(Json(serde_json::json!({ "error": "Employee not found" }))),
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
        let name = state.employee_repo.get_employee(&tenant.0, employee_id).await.ok().flatten().map(|x| x.name);
        state
            .employee_repo
            .delete_employee(&tenant.0, employee_id)
            .await?;
        audit_log::record(&state, &tenant.0, actor.0, "employee.delete", "employee", Some(employee_id.to_string()), audit_log::deleted_name(name)).await;
        Ok(Json(serde_json::json!({ "message": "Employee deleted successfully" })))
    }

    pub async fn download_template(_tenant: TenantContext) -> Result<Response, AppError> {
        let bytes = xlsx_io::build_template(&[
            "name",
            "email",
            HOURS_COLUMN,
            "capabilities",
            "available_shifts",
        ])?;
        Ok(xlsx_io::xlsx_download_response(bytes, "employees_template.xlsx"))
    }

    pub async fn import_employees(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        multipart: Multipart,
    ) -> Result<Json<Value>, AppError> {
        let bytes = xlsx_io::extract_uploaded_file(multipart).await?;
        // An outdated template's hours were monthly; importing them as weekly
        // would quietly quadruple everyone's target.
        if let Some(old) = xlsx_io::parse_header(&bytes)?
            .get(2)
            .filter(|h| OLD_HOURS_COLUMNS.contains(&h.as_str()))
        {
            return Err(AppError::Validation(format!(
                "Column '{old}' is from an old template: hours are now per week. Download the current template and fill in '{HOURS_COLUMN}' (empty = the default)"
            )));
        }
        let rows = xlsx_io::parse_rows(&bytes)?;

        let cap_by_name: HashMap<String, Uuid> = state
            .capability_repo
            .list_capabilities(&tenant.0)
            .await?
            .into_iter()
            .map(|c| (c.name.to_lowercase(), c.id))
            .collect();
        let shift_by_name: HashMap<String, Uuid> = state
            .shift_repo
            .list_shifts(&tenant.0)
            .await?
            .into_iter()
            .map(|s| (s.name.to_lowercase(), s.id))
            .collect();

        let mut result = ImportResult::default();

        for (idx, row) in rows.iter().enumerate() {
            let row_num = idx + 2; // +1 for 0-index, +1 for header row
            let name = row.first().map(String::as_str).unwrap_or("");
            let email = row.get(1).map(String::as_str).unwrap_or("");
            let hours_str = row.get(2).map(String::as_str).unwrap_or("");
            let capabilities_str = row.get(3).map(String::as_str).unwrap_or("");
            let shifts_str = row.get(4).map(String::as_str).unwrap_or("");

            if name.is_empty() || email.is_empty() {
                result.push_error(row_num, "Missing required 'name' or 'email'");
                continue;
            }

            // Empty: the employee follows the tenant default.
            let weekly_working_hours: Option<f64> = if hours_str.is_empty() {
                None
            } else {
                match hours_str.parse::<f64>().ok().filter(|h| validate_weekly_hours(*h).is_ok()) {
                    Some(v) => Some(v),
                    None => {
                        result.push_error(row_num, format!("Invalid '{HOURS_COLUMN}' value: '{hours_str}' (0–{MAX_WEEKLY_HOURS}, or empty for the default)"));
                        continue;
                    }
                }
            };

            let employee = match state
                .employee_repo
                .create_employee(&tenant.0, name, email, weekly_working_hours)
                .await
            {
                Ok(e) => e,
                Err(AppError::Duplicate) => {
                    result.push_error(row_num, format!("Employee with email '{email}' already exists"));
                    continue;
                }
                Err(_) => {
                    result.push_error(row_num, "Failed to create employee");
                    continue;
                }
            };

            let mut warnings = Vec::new();
            for cap_name in xlsx_io::split_names(capabilities_str) {
                match cap_by_name.get(&cap_name.to_lowercase()) {
                    Some(id) => {
                        let _ = state.employee_repo.add_employee_capability(&tenant.0, employee.id, *id).await;
                    }
                    None => warnings.push(format!("capability '{cap_name}' not found")),
                }
            }
            for shift_name in xlsx_io::split_names(shifts_str) {
                match shift_by_name.get(&shift_name.to_lowercase()) {
                    Some(id) => {
                        let _ = state.employee_repo.add_employee_available_shift(&tenant.0, employee.id, *id).await;
                    }
                    None => warnings.push(format!("shift '{shift_name}' not found")),
                }
            }

            result.created += 1;
            if !warnings.is_empty() {
                result.errors.push(xlsx_io::ImportRowError {
                    row: row_num,
                    message: warnings.join("; "),
                });
            }
        }

        audit_log::record(
            &state,
            &tenant.0,
            actor.0,
            "employee.import",
            "employee",
            None,
            Some(serde_json::json!({ "created": result.created, "skipped": result.skipped }).to_string()),
        )
        .await;

        Ok(Json(serde_json::to_value(result).unwrap()))
    }
}
