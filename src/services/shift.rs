use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveTime;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::ShiftRepository;
use crate::services::employee::PaginationQuery;

#[derive(Deserialize)]
pub struct SetWeekdayTimeRequest {
    pub weekday: i16,
    pub start_time: String,
    pub end_time: String,
}

pub struct ShiftService;

impl ShiftService {
    pub async fn list_shifts(
        Query(_q): Query<PaginationQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let shifts = state
            .shift_repo
            .list_shifts()
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::to_value(shifts).unwrap()))
    }

    pub async fn create_shift(
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'name'".into()))?;

        let shift = state
            .shift_repo
            .create_shift(name)
            .await?;

        Ok(Json(serde_json::to_value(shift).unwrap()))
    }

    pub async fn get_shift_by_id(
        Path(shift_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let shift = state
            .shift_repo
            .get_shift(shift_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(shift).unwrap()))
    }

    pub async fn set_weekday_time(
        Path(shift_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<SetWeekdayTimeRequest>,
    ) -> Result<Json<Value>, AppError> {
        if body.weekday < 0 || body.weekday > 6 {
            return Err(AppError::Validation(
                "weekday must be between 0 (Monday) and 6 (Sunday)".into(),
            ));
        }

        let start_time = NaiveTime::parse_from_str(&body.start_time, "%H:%M")
            .or_else(|_| NaiveTime::parse_from_str(&body.start_time, "%H:%M:%S"))
            .map_err(|_| AppError::Validation("Invalid start_time format, use HH:MM".into()))?;

        let end_time = NaiveTime::parse_from_str(&body.end_time, "%H:%M")
            .or_else(|_| NaiveTime::parse_from_str(&body.end_time, "%H:%M:%S"))
            .map_err(|_| AppError::Validation("Invalid end_time format, use HH:MM".into()))?;

        let wt = state
            .shift_repo
            .set_weekday_time(shift_id, body.weekday, start_time, end_time)
            .await?;

        Ok(Json(serde_json::to_value(wt).unwrap()))
    }

    pub async fn delete_weekday_time(
        Path((shift_id, weekday)): Path<(Uuid, i16)>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        if weekday < 0 || weekday > 6 {
            return Err(AppError::Validation(
                "weekday must be between 0 (Monday) and 6 (Sunday)".into(),
            ));
        }

        state
            .shift_repo
            .delete_weekday_time(shift_id, weekday)
            .await?;

        Ok(Json(serde_json::json!({ "message": "Weekday time deleted" })))
    }
}
