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
use crate::repository::domain::{ShiftWish, ShiftWishRepository};
use crate::services::tenant::TenantContext;

#[derive(Deserialize)]
pub struct ListShiftWishesQuery {
    pub employee_id: Option<Uuid>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

pub struct ShiftWishService;

impl ShiftWishService {
    pub async fn list_shift_wishes(
        tenant: TenantContext,
        Query(q): Query<ListShiftWishesQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let wishes = if let Some(employee_id) = q.employee_id {
            state
                .shift_wish_repo
                .get_shift_wishes_for_employee(&tenant.0, employee_id)
                .await
                .map_err(|_| AppError::Internal)?
        } else {
            state
                .shift_wish_repo
                .list_shift_wishes(&tenant.0)
                .await
                .map_err(|_| AppError::Internal)?
        };

        // Client-side date filtering if both from_date and to_date are provided
        let filtered = if let (Some(from_str), Some(to_str)) = (q.from_date, q.to_date) {
            let from_date = NaiveDate::parse_from_str(&from_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
            let to_date = NaiveDate::parse_from_str(&to_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;
            wishes
                .into_iter()
                .filter(|w| w.wish_date >= from_date && w.wish_date <= to_date)
                .collect()
        } else {
            wishes
        };

        Ok(Json(serde_json::to_value(filtered).unwrap()))
    }

    pub async fn create_shift_wish(
        tenant: TenantContext,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let employee_id = body
            .get("employee_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'employee_id'".into()))?
            .parse::<Uuid>()
            .map_err(|_| AppError::Validation("Invalid 'employee_id' UUID".into()))?;

        let shift_id = body
            .get("shift_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'shift_id'".into()))?
            .parse::<Uuid>()
            .map_err(|_| AppError::Validation("Invalid 'shift_id' UUID".into()))?;

        let wish_date_str = body
            .get("wish_date")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'wish_date'".into()))?;

        let wish_date = NaiveDate::parse_from_str(wish_date_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'wish_date' format, use YYYY-MM-DD".into()))?;

        let wish = ShiftWish {
            id: Uuid::new_v4(), // Will be replaced by DB-generated ID
            employee_id,
            shift_id,
            wish_date,
        };

        let created = state
            .shift_wish_repo
            .create_shift_wish(&tenant.0, wish)
            .await?;

        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    pub async fn get_shift_wish_by_id(
        tenant: TenantContext,
        Path(wish_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let wish = state
            .shift_wish_repo
            .get_shift_wish(&tenant.0, wish_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(wish).unwrap()))
    }

    pub async fn delete_shift_wish(
        tenant: TenantContext,
        Path(wish_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .shift_wish_repo
            .get_shift_wish(&tenant.0, wish_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        state
            .shift_wish_repo
            .delete_shift_wish(&tenant.0, wish_id)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::json!({ "message": "Shift wish deleted successfully" })))
    }
}
