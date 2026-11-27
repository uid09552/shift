//! Call-ins on on-call duties: the minutes someone on call from home
//! (Rufbereitschaft, duty type `on_call`) was actually called in, recorded
//! afterwards by a planner. Only these minutes are working time — the solver
//! and the plan check count them in the labor-law hour windows through
//! `history[].called_in_minutes`.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use diesel::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::domain::{ConfirmedShiftPlanRepository, ShiftRepository};
use crate::repository::AppState;
use crate::schema::on_call_call_ins;
use crate::services::audit_log::{self, AuditActor};
use crate::services::shift_swap::{actor_name, caller_employee, ensure_planner};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};
use crate::telemetry;

#[derive(Deserialize)]
pub struct CallInQuery {
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
}

#[derive(Deserialize)]
pub struct PutCallIn {
    pub employee_id: Uuid,
    pub date: NaiveDate,
    pub minutes: i32,
    #[serde(default)]
    pub note: Option<String>,
}

type Row = (Uuid, NaiveDate, i32, Option<String>, Option<String>);

/// (employee, day) -> minutes called in, over a range.
pub async fn minutes_in_range(
    state: &AppState,
    tenant_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<HashMap<(Uuid, NaiveDate), i32>, AppError> {
    Ok(rows(state, tenant_id, from, to, None).await?.into_iter().map(|(e, d, m, _, _)| ((e, d), m)).collect())
}

async fn rows(
    state: &AppState,
    tenant_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    employee: Option<Uuid>,
) -> Result<Vec<Row>, AppError> {
    let tenant_id = tenant_id.to_string();
    let pool = std::sync::Arc::clone(&state.pool);
    telemetry::db_blocking(move || {
        let mut conn = pool.get().map_err(|_| AppError::DbError)?;
        let mut query = on_call_call_ins::table
            .filter(on_call_call_ins::tenant_id.eq(&tenant_id))
            .filter(on_call_call_ins::date.between(from, to))
            .order((on_call_call_ins::date, on_call_call_ins::employee_id))
            .select((
                on_call_call_ins::employee_id,
                on_call_call_ins::date,
                on_call_call_ins::minutes,
                on_call_call_ins::note,
                on_call_call_ins::recorded_by,
            ))
            .into_boxed();
        if let Some(employee) = employee {
            query = query.filter(on_call_call_ins::employee_id.eq(employee));
        }
        query.load::<Row>(&mut conn).map_err(|_| AppError::DbError)
    })
    .await
    .map_err(|_| AppError::Internal)?
}

fn row_json((employee_id, date, minutes, note, recorded_by): &Row) -> Value {
    json!({"employee_id": employee_id, "date": date, "minutes": minutes, "note": note, "recorded_by": recorded_by})
}

/// The confirmed roster that day must be an on-call duty: a call-in on
/// anything else would be ordinary overtime, which this does not model.
async fn ensure_on_call(state: &AppState, tenant_id: &str, employee_id: Uuid, date: NaiveDate) -> Result<(), AppError> {
    let entry = state
        .confirmed_shift_plan_repo
        .get_confirmed_shift_plans_for_date_range(tenant_id, date, date, None, None, false)
        .await?
        .into_iter()
        .find(|p| p.employee_id == employee_id && p.date == date && p.is_present);
    let Some(shift_id) = entry.and_then(|p| p.shift_id) else {
        return Err(AppError::Validation("Nobody is on the roster for that day".into()));
    };
    match state.shift_repo.get_shift(tenant_id, shift_id).await? {
        Some(shift) if shift.duty_type == "on_call" => Ok(()),
        _ => Err(AppError::Validation("A call-in is recorded on an on-call duty only".into())),
    }
}

pub struct CallInService;

impl CallInService {
    /// GET /call-ins?from_date&to_date — viewers see their own.
    pub async fn list(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        Query(q): Query<CallInQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        if q.to_date < q.from_date || (q.to_date - q.from_date).num_days() > 366 {
            return Err(AppError::Validation("from_date..to_date must be at most a year, in order".into()));
        }
        let employee = if roles.can_write() {
            None
        } else {
            match caller_employee(&state, &tenant, &user).await? {
                Some(me) => Some(me.id),
                None => return Ok(Json(json!([]))),
            }
        };
        let list = rows(&state, &tenant.0, q.from_date, q.to_date, employee).await?;
        Ok(Json(json!(list.iter().map(row_json).collect::<Vec<_>>())))
    }

    /// PUT /call-ins — records (replaces) the minutes called in on an on-call day.
    pub async fn put(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<PutCallIn>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles).map_err(|_| AppError::Forbidden("Only a planner or an admin records call-ins".into()))?;
        if !(0..=1440).contains(&body.minutes) {
            return Err(AppError::Validation("minutes must be between 0 and 1440".into()));
        }
        ensure_on_call(&state, &tenant.0, body.employee_id, body.date).await?;
        let recorded_by = actor_name(&actor, &user);
        let (tenant_id, by, note) = (tenant.0.clone(), recorded_by.clone(), body.note.clone().filter(|n| !n.trim().is_empty()));
        let (employee_id, date, minutes) = (body.employee_id, body.date, body.minutes);
        let pool = std::sync::Arc::clone(&state.pool);
        let saved: Row = telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let values = (
                on_call_call_ins::tenant_id.eq(&tenant_id),
                on_call_call_ins::employee_id.eq(employee_id),
                on_call_call_ins::date.eq(date),
                on_call_call_ins::minutes.eq(minutes),
                on_call_call_ins::note.eq(&note),
                on_call_call_ins::recorded_by.eq(&by),
            );
            diesel::insert_into(on_call_call_ins::table)
                .values(values)
                .on_conflict((on_call_call_ins::employee_id, on_call_call_ins::date))
                .do_update()
                .set((
                    on_call_call_ins::minutes.eq(minutes),
                    on_call_call_ins::note.eq(&note),
                    on_call_call_ins::recorded_by.eq(&by),
                    on_call_call_ins::updated_at.eq(chrono::Utc::now().naive_utc()),
                ))
                .returning((
                    on_call_call_ins::employee_id,
                    on_call_call_ins::date,
                    on_call_call_ins::minutes,
                    on_call_call_ins::note,
                    on_call_call_ins::recorded_by,
                ))
                .get_result::<Row>(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)??;
        audit_log::record(
            &state, &tenant.0, recorded_by, "call_in.record", "employee", Some(body.employee_id.to_string()),
            Some(json!({"date": body.date, "minutes": body.minutes}).to_string()),
        )
        .await;
        Ok(Json(row_json(&saved)))
    }

    /// DELETE /call-ins/{employee_id}/{date}
    pub async fn delete(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path((employee_id, date)): Path<(Uuid, NaiveDate)>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles).map_err(|_| AppError::Forbidden("Only a planner or an admin records call-ins".into()))?;
        let tenant_id = tenant.0.clone();
        let pool = std::sync::Arc::clone(&state.pool);
        let removed = telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                on_call_call_ins::table
                    .filter(on_call_call_ins::tenant_id.eq(&tenant_id))
                    .filter(on_call_call_ins::employee_id.eq(employee_id))
                    .filter(on_call_call_ins::date.eq(date)),
            )
            .execute(&mut conn)
            .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)??;
        if removed == 0 {
            return Err(AppError::NotFound);
        }
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "call_in.delete", "employee", Some(employee_id.to_string()),
            Some(json!({"date": date}).to_string()),
        )
        .await;
        Ok(Json(json!({"deleted": true})))
    }
}
