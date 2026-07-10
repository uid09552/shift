use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::{ConfirmedShiftPlan, ConfirmedShiftPlanRepository};
use crate::services::tenant::TenantContext;

#[derive(Deserialize)]
pub struct ListConfirmedShiftPlansQuery {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
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

pub struct ConfirmedShiftPlanService;

impl ConfirmedShiftPlanService {
    /// GET /confirmed-shift-plans
    /// Lists all confirmed shift plans with pagination. Supports optional from_date/to_date query parameters for date range filtering.
    pub async fn list_confirmed_shift_plans(
        tenant: TenantContext,
        Query(q): Query<ListConfirmedShiftPlansQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let limit = q.limit.map(|l| l as i64);
        let offset = q.offset.map(|o| o as i64);

        let (plans, total) = if let (Some(from_str), Some(to_str)) = (q.from_date, q.to_date) {
            let from_date = NaiveDate::parse_from_str(&from_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
            let to_date = NaiveDate::parse_from_str(&to_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;
            let plans = state
                .confirmed_shift_plan_repo
                .get_confirmed_shift_plans_for_date_range(&tenant.0, from_date, to_date, limit, offset)
                .await
                .map_err(|_| AppError::Internal)?;
            let total = state
                .confirmed_shift_plan_repo
                .count_confirmed_shift_plans_for_date_range(&tenant.0, from_date, to_date)
                .await
                .map_err(|_| AppError::Internal)?;
            (plans, total)
        } else {
            let plans = state
                .confirmed_shift_plan_repo
                .list_confirmed_shift_plans(&tenant.0, limit, offset)
                .await
                .map_err(|_| AppError::Internal)?;
            let total = state
                .confirmed_shift_plan_repo
                .count_confirmed_shift_plans(&tenant.0)
                .await
                .map_err(|_| AppError::Internal)?;
            (plans, total)
        };

        let response = PaginatedResponse {
            data: plans,
            total,
            limit: limit.unwrap_or(50),
            offset: offset.unwrap_or(0),
        };
        Ok(Json(serde_json::to_value(response).unwrap()))
    }

    /// GET /employees/:employee_id/confirmed-shift-plans
    /// Returns the confirmed shift plans for a specific employee.
    /// Supports optional from_date/to_date query parameters for date range filtering.
    pub async fn get_employee_confirmed_shift_plans(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        Query(q): Query<ListConfirmedShiftPlansQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let plans = if let (Some(from_str), Some(to_str)) = (q.from_date, q.to_date) {
            let from_date = NaiveDate::parse_from_str(&from_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
            let to_date = NaiveDate::parse_from_str(&to_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;
            state
                .confirmed_shift_plan_repo
                .get_confirmed_shift_plans_for_employee_in_range(&tenant.0, employee_id, from_date, to_date)
                .await
                .map_err(|_| AppError::Internal)?
        } else {
            state
                .confirmed_shift_plan_repo
                .get_confirmed_shift_plans_for_employee(&tenant.0, employee_id)
                .await
                .map_err(|_| AppError::Internal)?
        };

        Ok(Json(serde_json::to_value(plans).unwrap()))
    }

    /// POST /employees/:employee_id/confirmed-shift-plans
    /// Creates a new confirmed shift plan entry for an employee.
    pub async fn create_confirmed_shift_plan(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let shift_id = body
            .get("shift_id")
            .and_then(|v| v.as_str())
            .map(|s| s.parse::<Uuid>().map_err(|_| AppError::Validation("Invalid 'shift_id' UUID".into())))
            .transpose()?;

        let workstation_id = body
            .get("workstation_id")
            .and_then(|v| v.as_str())
            .map(|s| s.parse::<Uuid>())
            .transpose()
            .map_err(|_| AppError::Validation("Invalid 'workstation_id' UUID".into()))?;

        let date_str = body
            .get("date")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'date'".into()))?;

        let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'date' format, use YYYY-MM-DD".into()))?;

        let is_present = body
            .get("is_present")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let absence_type = body
            .get("absence_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Validate absence_type if provided
        if let Some(ref at) = absence_type {
            let valid_absence = matches!(at.as_str(), "sick" | "day_off" | "holiday" | "unknown" | "unavailable" | "free");
            if !valid_absence {
                return Err(AppError::Validation(
                    "Invalid 'absence_type', must be one of: sick, day_off, holiday, unknown, unavailable, free".into(),
                ));
            }
        }

        // If not present, absence_type is required
        if !is_present && absence_type.is_none() {
            return Err(AppError::Validation(
                "absence_type is required when is_present is false".into(),
            ));
        }

        let creation_type = body
            .get("creation_type")
            .and_then(|v| v.as_str())
            .unwrap_or("manual")
            .to_string();

        // Validate creation_type
        let valid_creation = matches!(creation_type.as_str(), "manual" | "automated");
        if !valid_creation {
            return Err(AppError::Validation(
                "Invalid 'creation_type', must be one of: manual, automated".into(),
            ));
        }

        let now = Utc::now().naive_utc();

        let plan = ConfirmedShiftPlan {
            id: Uuid::new_v4(), // Will be replaced by DB-generated ID
            employee_id,
            shift_id,
            workstation_id,
            date,
            is_present,
            absence_type,
            creation_type,
            created_at: now,
            updated_at: now,
        };

        let created = state
            .confirmed_shift_plan_repo
            .create_confirmed_shift_plan(&tenant.0, plan)
            .await?;

        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    /// GET /confirmed-shift-plans/:plan_id
    /// Gets a specific confirmed shift plan by ID.
    pub async fn get_confirmed_shift_plan_by_id(
        tenant: TenantContext,
        Path(plan_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let plan = state
            .confirmed_shift_plan_repo
            .get_confirmed_shift_plan_by_id(&tenant.0, plan_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        Ok(Json(serde_json::to_value(plan).unwrap()))
    }

    /// PUT /confirmed-shift-plans/:plan_id
    /// Updates a specific confirmed shift plan.
    pub async fn update_confirmed_shift_plan(
        tenant: TenantContext,
        Path(plan_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let shift_id = if let Some(sid_val) = body.get("shift_id") {
            if sid_val.is_null() {
                Some(None)
            } else {
                let uuid = sid_val
                    .as_str()
                    .ok_or_else(|| AppError::Validation("Invalid 'shift_id', expected UUID string or null".into()))?
                    .parse::<Uuid>()
                    .map_err(|_| AppError::Validation("Invalid 'shift_id' UUID".into()))?;
                Some(Some(uuid))
            }
        } else {
            None
        };

        let workstation_id = if let Some(ws_val) = body.get("workstation_id") {
            // If the key is present, parse it (null means "clear the workstation")
            if ws_val.is_null() {
                Some(None)
            } else {
                Some(
                    ws_val
                        .as_str()
                        .ok_or_else(|| AppError::Validation("Invalid 'workstation_id', expected UUID string or null".into()))?
                        .parse::<Uuid>()
                        .map_err(|_| AppError::Validation("Invalid 'workstation_id' UUID".into()))?
                        .into(),
                )
            }
        } else {
            None
        };

        let is_present = body.get("is_present").and_then(|v| v.as_bool());

        let absence_type = body
            .get("absence_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Validate absence_type if provided
        if let Some(ref at) = absence_type {
            let valid_absence = matches!(at.as_str(), "sick" | "day_off" | "holiday" | "unknown" | "unavailable" | "free");
            if !valid_absence {
                return Err(AppError::Validation(
                    "Invalid 'absence_type', must be one of: sick, day_off, holiday, unknown, unavailable, free".into(),
                ));
            }
        }

        let creation_type = body
            .get("creation_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Validate creation_type if provided
        if let Some(ref ct) = creation_type {
            let valid_creation = matches!(ct.as_str(), "manual" | "automated");
            if !valid_creation {
                return Err(AppError::Validation(
                    "Invalid 'creation_type', must be one of: manual, automated".into(),
                ));
            }
        }

        let updated = state
            .confirmed_shift_plan_repo
            .update_confirmed_shift_plan(&tenant.0, plan_id, shift_id, workstation_id, is_present, absence_type, creation_type)
            .await?;

        Ok(Json(serde_json::to_value(updated).unwrap()))
    }

    /// DELETE /confirmed-shift-plans/:plan_id
    /// Deletes a specific confirmed shift plan.
    pub async fn delete_confirmed_shift_plan(
        tenant: TenantContext,
        Path(plan_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .confirmed_shift_plan_repo
            .delete_confirmed_shift_plan(&tenant.0, plan_id)
            .await?;

        Ok(Json(serde_json::json!({ "deleted": true })))
    }
}
