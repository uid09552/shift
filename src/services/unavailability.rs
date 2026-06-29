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
use crate::repository::domain::{ConfirmedShiftPlan, ConfirmedShiftPlanRepository, Unavailability, UnavailabilityRepository};
use chrono::Utc;

#[derive(Deserialize)]
pub struct ListUnavailabilitiesQuery {
    pub employee_id: Option<Uuid>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub struct UnavailabilityService;

impl UnavailabilityService {
    pub async fn list_unavailabilities(
        Query(q): Query<ListUnavailabilitiesQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let unavailabilities = if let Some(employee_id) = q.employee_id {
            state
                .unavailability_repo
                .get_unavailabilities_for_employee(employee_id)
                .await
                .map_err(|_| AppError::Internal)?
        } else {
            state
                .unavailability_repo
                .list_unavailabilities()
                .await
                .map_err(|_| AppError::Internal)?
        };

        // Client-side date filtering if both from_date and to_date are provided
        let filtered = if let (Some(from_str), Some(to_str)) = (q.from_date, q.to_date) {
            let from_date = NaiveDate::parse_from_str(&from_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
            let to_date = NaiveDate::parse_from_str(&to_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;
            unavailabilities
                .into_iter()
                .filter(|u| u.unavailable_date >= from_date && u.unavailable_date <= to_date)
                .collect()
        } else {
            unavailabilities
        };

        Ok(Json(serde_json::to_value(filtered).unwrap()))
    }

    pub async fn create_unavailability(
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let employee_id = body
            .get("employee_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'employee_id'".into()))?
            .parse::<Uuid>()
            .map_err(|_| AppError::Validation("Invalid 'employee_id' UUID".into()))?;

        let unavailable_date_str = body
            .get("unavailable_date")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'unavailable_date'".into()))?;

        let unavailable_date = NaiveDate::parse_from_str(unavailable_date_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'unavailable_date' format, use YYYY-MM-DD".into()))?;

        let shift_id = body
            .get("shift_id")
            .and_then(|v| v.as_str())
            .map(|s| s.parse::<Uuid>())
            .transpose()
            .map_err(|_| AppError::Validation("Invalid 'shift_id' UUID".into()))?;

        let unavailability = Unavailability {
            id: Uuid::new_v4(), // Will be replaced by DB-generated ID
            employee_id,
            unavailable_date,
            shift_id,
        };

        let created = state
            .unavailability_repo
            .create_unavailability(unavailability)
            .await
            .map_err(|_| AppError::Internal)?;

        // Mirror the unavailability as a confirmed shift plan with absence_type = 'unavailable'
        // so that planner calendar UIs display the blocked day automatically.
        let now = Utc::now().naive_utc();
        let plan = ConfirmedShiftPlan {
            id: Uuid::new_v4(),
            employee_id,
            shift_id,  // propagate shift-specific flag if present
            workstation_id: None,
            date: unavailable_date,
            is_present: false,
            absence_type: Some("unavailable".to_string()),
            creation_type: "manual".to_string(),
            created_at: now,
            updated_at: now,
        };
        let _ = state
            .confirmed_shift_plan_repo
            .create_confirmed_shift_plan(plan)
            .await;  // best-effort; don't fail the main request if sync fails

        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    pub async fn get_unavailability_by_id(
        Path(unavailability_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let unavailability = state
            .unavailability_repo
            .get_unavailability(unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(unavailability).unwrap()))
    }

    pub async fn delete_unavailability(
        Path(unavailability_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        // Fetch first so we can cascade-delete the mirrored confirmed plan entry.
        let unavailability = state
            .unavailability_repo
            .get_unavailability(unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        state
            .unavailability_repo
            .delete_unavailability(unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?;

        // Remove the mirrored confirmed shift plan (best-effort).
        let _ = state
            .confirmed_shift_plan_repo
            .delete_confirmed_shift_plans_for_employee_date_type(
                unavailability.employee_id,
                unavailability.unavailable_date,
                "unavailable",
            )
            .await;

        Ok(Json(serde_json::json!({ "message": "Unavailability deleted successfully" })))
    }
}
