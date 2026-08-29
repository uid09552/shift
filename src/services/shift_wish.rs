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
use crate::repository::domain::{
    EmployeeRepository, ShiftWish, ShiftWishRepository, WishMode, WishSettingsRepository,
};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};

#[derive(Deserialize)]
pub struct ListShiftWishesQuery {
    pub employee_id: Option<Uuid>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

pub struct ShiftWishService;

/// Verifies the caller may write the wish of `employee_id` for `wish_date`.
///
/// Two independent rules, in this order:
///
/// 1. **The wish window binds every role.** A closed window is a lock, not a
///    self-service policy: while it is shut nobody adds or withdraws a wish —
///    `shift-admin` included. An admin who needs to change one re-opens the window
///    first, which leaves an audit entry saying so.
/// 2. **Whose wish it is.** `shift-planner` and `shift-admin` write anyone's;
///    everyone else — in practice `shift-viewer`, the only other role that reaches
///    these handlers — only their own, matched by the employee's e-mail address
///    against the caller's `email` / `preferred_username` token claims.
async fn authorize_wish_for_employee(
    tenant: &TenantContext,
    roles: &RoleContext,
    user: &UserContext,
    state: &AppState,
    employee_id: Uuid,
    wish_date: NaiveDate,
) -> Result<(), AppError> {
    ensure_wish_window_open(tenant, state, wish_date).await?;

    if roles.can_write() {
        return Ok(());
    }

    let employee = state
        .employee_repo
        .get_employee(&tenant.0, employee_id)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;

    if !user.matches_email(&employee.email) {
        return Err(AppError::Forbidden(
            "You may only manage your own shift wishes".into(),
        ));
    }

    Ok(())
}

/// Rejects a wish the tenant's window does not allow, whoever is asking. The message
/// is the one the UI shows, so it names the reason rather than just saying "forbidden".
async fn ensure_wish_window_open(
    tenant: &TenantContext,
    state: &AppState,
    wish_date: NaiveDate,
) -> Result<(), AppError> {
    let settings = state
        .wish_settings_repo
        .get_or_create_wish_settings(&tenant.0)
        .await?;

    if settings.allows_wish_on(wish_date) {
        return Ok(());
    }

    Err(AppError::Forbidden(match settings.mode {
        WishMode::Disabled => "Shift wishes are currently closed".to_string(),
        _ => format!(
            "Shift wishes may only be placed for dates between {} and {}",
            settings.window_start.map(|d| d.to_string()).unwrap_or_else(|| "—".into()),
            settings.window_end.map(|d| d.to_string()).unwrap_or_else(|| "—".into()),
        ),
    }))
}

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
        roles: RoleContext,
        user: UserContext,
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

        authorize_wish_for_employee(&tenant, &roles, &user, &state, employee_id, wish_date).await?;

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
        roles: RoleContext,
        user: UserContext,
        Path(wish_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let wish = state
            .shift_wish_repo
            .get_shift_wish(&tenant.0, wish_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        authorize_wish_for_employee(&tenant, &roles, &user, &state, wish.employee_id, wish.wish_date).await?;

        state
            .shift_wish_repo
            .delete_shift_wish(&tenant.0, wish_id)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::json!({ "message": "Shift wish deleted successfully" })))
    }
}
