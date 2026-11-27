//! Staffing demand by hour: how many people a workstation needs in each hour
//! of a weekday (`workstation_demand`). Sent to the solver as
//! `workstations[].demand`; on a weekday with a curve the curve replaces the
//! workstation's per-shift `min_employees` there.

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    Json,
};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::domain::WorkstationRepository;
use crate::repository::AppState;
use crate::schema::workstation_demand;
use crate::services::audit_log::{self, AuditActor};
use crate::services::shift_swap::{actor_name, ensure_planner};
use crate::services::tenant::{RoleContext, TenantContext, UserContext};
use crate::telemetry;

/// Most people a curve may ask for in one hour.
pub const MAX_HEADCOUNT: i16 = 99;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct DemandDay {
    /// 0 = Monday … 6 = Sunday (public holidays use Sunday's curve).
    pub weekday: i16,
    /// Headcount for 00:00–01:00, 01:00–02:00, … 23:00–24:00.
    pub hours: Vec<i16>,
}

#[derive(Deserialize)]
pub struct PutDemand {
    #[serde(default)]
    pub weekdays: Vec<DemandDay>,
}

/// Each workstation's curves: workstation -> [(weekday, 24 headcounts)].
pub async fn curves_for_tenant(state: &AppState, tenant_id: &str) -> Result<HashMap<Uuid, Vec<(i16, Vec<i16>)>>, AppError> {
    let tenant_id = tenant_id.to_string();
    let pool = std::sync::Arc::clone(&state.pool);
    let rows: Vec<(Uuid, i16, Vec<i16>)> = telemetry::db_blocking(move || {
        let mut conn = pool.get().map_err(|_| AppError::DbError)?;
        workstation_demand::table
            .filter(workstation_demand::tenant_id.eq(&tenant_id))
            .order((workstation_demand::workstation_id, workstation_demand::weekday))
            .select((workstation_demand::workstation_id, workstation_demand::weekday, workstation_demand::hours))
            .load(&mut conn)
            .map_err(|_| AppError::DbError)
    })
    .await
    .map_err(|_| AppError::Internal)??;
    let mut out: HashMap<Uuid, Vec<(i16, Vec<i16>)>> = HashMap::new();
    for (ws, weekday, hours) in rows {
        out.entry(ws).or_default().push((weekday, hours));
    }
    Ok(out)
}

/// Bounds, one entry per weekday, sorted; all-zero days dropped (no curve).
pub fn validate(mut days: Vec<DemandDay>) -> Result<Vec<DemandDay>, AppError> {
    days.sort_by_key(|d| d.weekday);
    for pair in days.windows(2) {
        if pair[0].weekday == pair[1].weekday {
            return Err(AppError::Validation(format!("weekday {} appears twice", pair[0].weekday)));
        }
    }
    for day in &days {
        if !(0..=6).contains(&day.weekday) {
            return Err(AppError::Validation("weekday must be between 0 (Monday) and 6 (Sunday)".into()));
        }
        if day.hours.len() != 24 {
            return Err(AppError::Validation("hours must hold 24 headcounts, one per hour".into()));
        }
        if day.hours.iter().any(|h| !(0..=MAX_HEADCOUNT).contains(h)) {
            return Err(AppError::Validation(format!("a headcount must be between 0 and {MAX_HEADCOUNT}")));
        }
    }
    days.retain(|d| d.hours.iter().any(|h| *h > 0));
    Ok(days)
}

fn body(workstation_id: Uuid, days: &[(i16, Vec<i16>)]) -> Value {
    json!({
        "workstation_id": workstation_id,
        "weekdays": days.iter().map(|(weekday, hours)| json!({"weekday": weekday, "hours": hours})).collect::<Vec<_>>(),
    })
}

async fn ensure_workstation(state: &AppState, tenant_id: &str, id: Uuid) -> Result<(), AppError> {
    state.workstation_repo.get_workstation(tenant_id, id).await?.map(|_| ()).ok_or(AppError::NotFound)
}

pub struct DemandService;

impl DemandService {
    /// GET /workstation-demand — every workstation's curves.
    pub async fn list_all(tenant: TenantContext, State(state): State<AppState>) -> Result<Json<Value>, AppError> {
        let curves = curves_for_tenant(&state, &tenant.0).await?;
        let mut list: Vec<Value> = curves.iter().map(|(ws, days)| body(*ws, days)).collect();
        list.sort_by_key(|v| v["workstation_id"].as_str().unwrap_or_default().to_string());
        Ok(Json(json!(list)))
    }

    /// GET /workstations/{id}/demand
    pub async fn get(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        ensure_workstation(&state, &tenant.0, workstation_id).await?;
        let curves = curves_for_tenant(&state, &tenant.0).await?;
        Ok(Json(body(workstation_id, curves.get(&workstation_id).map(Vec::as_slice).unwrap_or(&[]))))
    }

    /// PUT /workstations/{id}/demand — replaces the workstation's curves; an
    /// empty list (or all-zero days) removes them.
    pub async fn put(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(request): Json<PutDemand>,
    ) -> Result<Json<Value>, AppError> {
        ensure_planner(&roles).map_err(|_| AppError::Forbidden("Only a planner or an admin may change staffing demand".into()))?;
        ensure_workstation(&state, &tenant.0, workstation_id).await?;
        let days = validate(request.weekdays)?;
        let tenant_id = tenant.0.clone();
        let pool = std::sync::Arc::clone(&state.pool);
        let rows: Vec<(i16, Vec<i16>)> = days.iter().map(|d| (d.weekday, d.hours.clone())).collect();
        let stored = rows.clone();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, diesel::result::Error, _>(|conn| {
                diesel::delete(
                    workstation_demand::table
                        .filter(workstation_demand::tenant_id.eq(&tenant_id))
                        .filter(workstation_demand::workstation_id.eq(workstation_id)),
                )
                .execute(conn)?;
                for (weekday, hours) in &rows {
                    diesel::insert_into(workstation_demand::table)
                        .values((
                            workstation_demand::tenant_id.eq(&tenant_id),
                            workstation_demand::workstation_id.eq(workstation_id),
                            workstation_demand::weekday.eq(weekday),
                            workstation_demand::hours.eq(hours),
                        ))
                        .execute(conn)?;
                }
                Ok(())
            })
            .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)??;
        let answer = body(workstation_id, &stored);
        audit_log::record(
            &state, &tenant.0, actor_name(&actor, &user), "workstation.demand.update", "workstation",
            Some(workstation_id.to_string()), Some(answer.to_string()),
        )
        .await;
        Ok(Json(answer))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(weekday: i16, hours: Vec<i16>) -> DemandDay {
        DemandDay { weekday, hours }
    }

    #[test]
    fn a_curve_is_24_bounded_headcounts_per_weekday() {
        assert!(validate(vec![day(0, vec![1; 24])]).is_ok());
        assert!(validate(vec![day(0, vec![1; 23])]).is_err());
        assert!(validate(vec![day(7, vec![1; 24])]).is_err());
        assert!(validate(vec![day(0, vec![100; 24])]).is_err());
        assert!(validate(vec![day(0, vec![-1; 24])]).is_err());
        assert!(validate(vec![day(2, vec![1; 24]), day(2, vec![2; 24])]).is_err());
    }

    #[test]
    fn days_are_sorted_and_empty_days_dropped() {
        let out = validate(vec![day(4, vec![1; 24]), day(1, vec![0; 24]), day(0, vec![2; 24])]).unwrap();
        assert_eq!(out.iter().map(|d| d.weekday).collect::<Vec<_>>(), vec![0, 4]);
    }
}
