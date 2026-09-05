use axum::{
    extract::{Multipart, Path, Query, State},
    response::Response,
    Json,
};
use chrono::NaiveTime;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::ShiftRepository;
use crate::services::audit_log::{self, AuditActor};
use crate::services::employee::PaginationQuery;
use crate::services::tenant::TenantContext;
use crate::services::xlsx_io::{self, ImportResult};

#[derive(Deserialize)]
pub struct SetWeekdayTimeRequest {
    pub weekday: i16,
    pub start_time: String,
    pub end_time: String,
    pub min_employees: Option<i16>,
    pub max_employees: Option<i16>,
    pub free_days_after_shift: Option<i16>,
}

pub struct ShiftService;

impl ShiftService {
    pub async fn list_shifts(
        tenant: TenantContext,
        Query(_q): Query<PaginationQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let shifts = state
            .shift_repo
            .list_shifts(&tenant.0)
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Json(serde_json::to_value(shifts).unwrap()))
    }

    pub async fn create_shift(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'name'".into()))?;

        let short_name = body
            .get("short_name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'short_name'".into()))?;

        let color = body
            .get("color")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'color'".into()))?;

        // Validate hex color format
        if !color.starts_with('#') || color.len() != 7 || !color[1..].chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(AppError::Validation("Invalid 'color' format, must be hex color e.g. #3B82F6".into()));
        }

        let order = body
            .get("order")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;

        let shift = state
            .shift_repo
            .create_shift(&tenant.0, name, short_name, color, order)
            .await?;

        audit_log::record(&state, &tenant.0, actor.0, "shift.create", "shift", Some(shift.id.to_string()), Some(body.to_string())).await;

        Ok(Json(serde_json::to_value(shift).unwrap()))
    }

    pub async fn get_shift_by_id(
        tenant: TenantContext,
        Path(shift_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let shift = state
            .shift_repo
            .get_shift(&tenant.0, shift_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(shift).unwrap()))
    }

    pub async fn update_shift(
        tenant: TenantContext,
        actor: AuditActor,
        Path(shift_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        let name = body.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
        let short_name = body.get("short_name").and_then(|v| v.as_str()).map(|s| s.to_string());
        let color = body.get("color").and_then(|v| v.as_str()).map(|s| s.to_string());
        let order = body.get("order").and_then(|v| v.as_i64()).map(|o| o as i32);

        // Validate hex color format if color is provided
        if let Some(ref c) = color {
            if !c.starts_with('#') || c.len() != 7 || !c[1..].chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(AppError::Validation("Invalid 'color' format, must be hex color e.g. #3B82F6".into()));
            }
        }

        let shift = state
            .shift_repo
            .update_shift(&tenant.0, shift_id, name, short_name, color, order)
            .await?;

        audit_log::record(&state, &tenant.0, actor.0, "shift.update", "shift", Some(shift_id.to_string()), Some(body.to_string())).await;

        Ok(Json(serde_json::to_value(shift).unwrap()))
    }

    pub async fn set_weekday_time(
        tenant: TenantContext,
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

        // A weekday time is a start plus a duration, and the duration may run
        // past midnight — `end_time < start_time` means the shift ends on the
        // next day (see AnalysisRepository's hour maths and the optimizer's
        // `_shift_duration_hours`). Equal times are the one case that has no
        // reading: zero hours or a full 24 are indistinguishable.
        if start_time == end_time {
            return Err(AppError::Validation(
                "end_time must differ from start_time; a shift ending after midnight is expressed with an end_time earlier than its start_time".into(),
            ));
        }

        let min_employees = body.min_employees.unwrap_or(1);
        if min_employees < 0 {
            return Err(AppError::Validation("min_employees must be >= 0".into()));
        }

        let max_employees = body.max_employees;
        if let Some(max) = max_employees {
            if max < min_employees {
                return Err(AppError::Validation(
                    "max_employees must be >= min_employees".into(),
                ));
            }
        }

        let free_days_after_shift = body.free_days_after_shift.unwrap_or(0);
        if !(0..=5).contains(&free_days_after_shift) {
            return Err(AppError::Validation(
                "free_days_after_shift must be between 0 and 5".into(),
            ));
        }

        let wt = state
            .shift_repo
            .set_weekday_time(&tenant.0, shift_id, body.weekday, start_time, end_time, min_employees, max_employees, free_days_after_shift)
            .await?;

        Ok(Json(serde_json::to_value(wt).unwrap()))
    }

    pub async fn delete_weekday_time(
        tenant: TenantContext,
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
            .delete_weekday_time(&tenant.0, shift_id, weekday)
            .await?;

        Ok(Json(serde_json::json!({ "message": "Weekday time deleted" })))
    }

    pub async fn delete_shift(
        tenant: TenantContext,
        actor: AuditActor,
        Path(shift_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .shift_repo
            .delete_shift(&tenant.0, shift_id)
            .await?;
        audit_log::record(&state, &tenant.0, actor.0, "shift.delete", "shift", Some(shift_id.to_string()), None).await;
        Ok(Json(serde_json::json!({ "message": "Shift deleted successfully" })))
    }

    pub async fn download_template(_tenant: TenantContext) -> Result<Response, AppError> {
        let bytes = xlsx_io::build_template(&["name", "short_name", "color", "order"])?;
        Ok(xlsx_io::xlsx_download_response(bytes, "shifts_template.xlsx"))
    }

    pub async fn import_shifts(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        multipart: Multipart,
    ) -> Result<Json<Value>, AppError> {
        let bytes = xlsx_io::extract_uploaded_file(multipart).await?;
        let rows = xlsx_io::parse_rows(&bytes)?;

        let mut result = ImportResult::default();

        for (idx, row) in rows.iter().enumerate() {
            let row_num = idx + 2;
            let name = row.first().map(String::as_str).unwrap_or("");
            let short_name = row.get(1).map(String::as_str).unwrap_or("");
            let color = row.get(2).map(String::as_str).unwrap_or("");
            let order_str = row.get(3).map(String::as_str).unwrap_or("");

            if name.is_empty() || short_name.is_empty() || color.is_empty() {
                result.push_error(row_num, "Missing required 'name', 'short_name' or 'color'");
                continue;
            }

            if !color.starts_with('#') || color.len() != 7 || !color[1..].chars().all(|c| c.is_ascii_hexdigit()) {
                result.push_error(row_num, format!("Invalid 'color' format '{color}', must be hex e.g. #3B82F6"));
                continue;
            }

            let order: i32 = if order_str.is_empty() {
                0
            } else {
                match order_str.parse() {
                    Ok(v) => v,
                    Err(_) => {
                        result.push_error(row_num, format!("Invalid 'order' value: '{order_str}'"));
                        continue;
                    }
                }
            };

            match state.shift_repo.create_shift(&tenant.0, name, short_name, color, order).await {
                Ok(_) => result.created += 1,
                Err(AppError::Duplicate) => {
                    result.push_error(row_num, format!("Shift '{name}' already exists"));
                }
                Err(_) => {
                    result.push_error(row_num, "Failed to create shift");
                }
            }
        }

        audit_log::record(
            &state,
            &tenant.0,
            actor.0,
            "shift.import",
            "shift",
            None,
            Some(serde_json::json!({ "created": result.created, "skipped": result.skipped }).to_string()),
        )
        .await;

        Ok(Json(serde_json::to_value(result).unwrap()))
    }
}
