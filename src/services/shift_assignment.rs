use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::{EmployeeShiftAssignment, EmployeeShiftAssignmentRepository};

#[derive(Deserialize)]
pub struct ListShiftAssignmentsQuery {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

pub struct ShiftAssignmentService;

impl ShiftAssignmentService {
    /// GET /employees/:employee_id/shift-assignments
    /// Returns the fixed shift plan for a specific employee.
    /// Supports optional from_date/to_date query parameters for date range filtering.
    pub async fn get_employee_shift_assignments(
        Path(employee_id): Path<Uuid>,
        Query(q): Query<ListShiftAssignmentsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let assignments = if let (Some(from_str), Some(to_str)) = (q.from_date, q.to_date) {
            let from_date = NaiveDate::parse_from_str(&from_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
            let to_date = NaiveDate::parse_from_str(&to_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;
            state
                .shift_assignment_repo
                .get_assignments_for_employee_in_range(employee_id, from_date, to_date)
                .await
                .map_err(|_| AppError::Internal)?
        } else {
            state
                .shift_assignment_repo
                .get_assignments_for_employee(employee_id)
                .await
                .map_err(|_| AppError::Internal)?
        };

        Ok(Json(serde_json::to_value(assignments).unwrap()))
    }

    /// POST /employees/:employee_id/shift-assignments
    /// Creates a new fixed shift assignment for an employee.
    pub async fn create_shift_assignment(
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

        let date_str = body
            .get("date")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'date'".into()))?;

        let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'date' format, use YYYY-MM-DD".into()))?;

        let assignment = EmployeeShiftAssignment {
            id: Uuid::new_v4(), // Will be replaced by DB-generated ID
            employee_id,
            shift_id,
            date,
        };

        let created = state
            .shift_assignment_repo
            .create_assignment(assignment)
            .await
            .map_err(|e| {
                // Check if it's a duplicate violation from our repository
                if let Some(app_err) = e.downcast_ref::<AppError>() {
                    if matches!(app_err, AppError::Duplicate) {
                        return AppError::Duplicate;
                    }
                }
                AppError::Internal
            })?;

        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    /// DELETE /shift-assignments/:assignment_id
    /// Deletes a specific shift assignment.
    pub async fn delete_shift_assignment(
        Path(assignment_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .shift_assignment_repo
            .delete_assignment(assignment_id)
            .await
            .map_err(|e| {
                if let Some(app_err) = e.downcast_ref::<AppError>() {
                    if matches!(app_err, AppError::NotFound) {
                        return AppError::NotFound;
                    }
                }
                AppError::Internal
            })?;

        Ok(Json(serde_json::json!({ "deleted": true })))
    }
}
