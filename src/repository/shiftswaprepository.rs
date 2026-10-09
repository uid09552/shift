use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;
use crate::telemetry;
use crate::errors::AppError;

use crate::database::DbPool;
use crate::repository::domain::{
    swap_roster_conflict, swap_status, ConfirmedShiftPlan, ShiftSwapRepository, ShiftSwapRequest,
    SwapApproval, SwapSide,
};
use crate::models as models;
use crate::repository::rostertracking;
use crate::schema::{confirmed_shift_plans, employees, shift_swap_requests};
use crate::services::roster_guard::RosterChangeCtx;

fn to_domain(r: models::ShiftSwapRequest) -> ShiftSwapRequest {
    ShiftSwapRequest {
        id: r.id,
        requester: SwapSide {
            employee_id: r.requester_id,
            date: r.requester_date,
            shift_id: r.requester_shift_id,
            workstation_id: r.requester_workstation_id,
        },
        colleague: SwapSide {
            employee_id: r.colleague_id,
            date: r.colleague_date,
            shift_id: r.colleague_shift_id,
            workstation_id: r.colleague_workstation_id,
        },
        status: r.status,
        decided_by: r.decided_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

fn plan_to_domain(p: models::ConfirmedShiftPlan) -> ConfirmedShiftPlan {
    ConfirmedShiftPlan {
        id: p.id,
        employee_id: p.employee_id,
        shift_id: p.shift_id,
        workstation_id: p.workstation_id,
        date: p.date,
        is_present: p.is_present,
        absence_type: p.absence_type,
        creation_type: p.creation_type,
        created_at: p.created_at,
        updated_at: p.updated_at,
    }
}

#[derive(Clone)]
pub struct DieselShiftSwapRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl ShiftSwapRepository for DieselShiftSwapRepository {
    async fn create_swap(&self, tenant_id: &str, requester: SwapSide, colleague: SwapSide) -> Result<ShiftSwapRequest, AppError> {
        let pool = Arc::clone(&self.pool);
        let new_swap = models::NewShiftSwapRequest {
            tenant_id: tenant_id.to_string(),
            requester_id: requester.employee_id,
            requester_date: requester.date,
            requester_shift_id: requester.shift_id,
            requester_workstation_id: requester.workstation_id,
            colleague_id: colleague.employee_id,
            colleague_date: colleague.date,
            colleague_shift_id: colleague.shift_id,
            colleague_workstation_id: colleague.workstation_id,
        };
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(shift_swap_requests::table)
                .values(&new_swap)
                .get_result::<models::ShiftSwapRequest>(&mut conn)
                .map(to_domain)
                .map_err(AppError::from)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_swap(&self, tenant_id: &str, id: Uuid) -> Result<Option<ShiftSwapRequest>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            shift_swap_requests::table
                .filter(shift_swap_requests::id.eq(id))
                .filter(shift_swap_requests::tenant_id.eq(&tenant_id))
                .first::<models::ShiftSwapRequest>(&mut conn)
                .optional()
                .map(|r| r.map(to_domain))
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_swaps(&self, tenant_id: &str, employee_id: Option<Uuid>, status: Option<String>) -> Result<Vec<ShiftSwapRequest>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = shift_swap_requests::table
                .filter(shift_swap_requests::tenant_id.eq(&tenant_id))
                .order(shift_swap_requests::created_at.desc())
                .into_boxed();
            if let Some(employee_id) = employee_id {
                query = query.filter(
                    shift_swap_requests::requester_id.eq(employee_id)
                        .or(shift_swap_requests::colleague_id.eq(employee_id)),
                );
            }
            if let Some(status) = status {
                query = query.filter(shift_swap_requests::status.eq(status));
            }
            query
                .load::<models::ShiftSwapRequest>(&mut conn)
                .map(|rows| rows.into_iter().map(to_domain).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn count_swaps_with_status(&self, tenant_id: &str, status: &str) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let status = status.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            shift_swap_requests::table
                .filter(shift_swap_requests::tenant_id.eq(&tenant_id))
                .filter(shift_swap_requests::status.eq(&status))
                .count()
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn transition_swap(&self, tenant_id: &str, id: Uuid, from: &[&str], to: &str, decided_by: Option<String>) -> Result<Option<ShiftSwapRequest>, AppError> {
        let tenant_id = tenant_id.to_string();
        let from: Vec<String> = from.iter().map(|s| s.to_string()).collect();
        let to = to.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            // The status filter makes the check and the write one statement, so
            // two answers racing for the same request cannot both win.
            diesel::update(
                shift_swap_requests::table
                    .filter(shift_swap_requests::id.eq(id))
                    .filter(shift_swap_requests::tenant_id.eq(&tenant_id))
                    .filter(shift_swap_requests::status.eq_any(&from)),
            )
                .set((
                    shift_swap_requests::status.eq(&to),
                    shift_swap_requests::decided_by.eq(&decided_by),
                    shift_swap_requests::updated_at.eq(diesel::dsl::now),
                ))
                .get_result::<models::ShiftSwapRequest>(&mut conn)
                .optional()
                .map(|r| r.map(to_domain))
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn expire_swaps(&self, tenant_id: &str, today: NaiveDate) -> Result<usize, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                shift_swap_requests::table
                    .filter(shift_swap_requests::tenant_id.eq(&tenant_id))
                    .filter(shift_swap_requests::status.eq_any(swap_status::PENDING))
                    .filter(
                        shift_swap_requests::requester_date.lt(today)
                            .or(shift_swap_requests::colleague_date.lt(today)),
                    ),
            )
                .set((
                    shift_swap_requests::status.eq(swap_status::EXPIRED),
                    shift_swap_requests::updated_at.eq(diesel::dsl::now),
                ))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn approve_swap(&self, tenant_id: &str, id: Uuid, decided_by: Option<String>, ctx: &RosterChangeCtx) -> Result<SwapApproval, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        let ctx = ctx.clone();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                let swap = shift_swap_requests::table
                    .filter(shift_swap_requests::id.eq(id))
                    .filter(shift_swap_requests::tenant_id.eq(&tenant_id))
                    .for_update()
                    .first::<models::ShiftSwapRequest>(conn)
                    .optional()?
                    .map(to_domain)
                    .ok_or(AppError::NotFound)?;
                if swap.status != swap_status::PENDING_PLANNER {
                    return Err(AppError::Conflict(format!(
                        "This swap is {}, not awaiting a planner's decision",
                        swap.status
                    )));
                }
                let (a, b) = (swap.requester.clone(), swap.colleague.clone());

                // Both people on both dates, locked until the exchange is written.
                let rows: Vec<ConfirmedShiftPlan> = confirmed_shift_plans::table
                    .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                    .filter(confirmed_shift_plans::employee_id.eq_any([a.employee_id, b.employee_id]))
                    .filter(confirmed_shift_plans::date.eq_any([a.date, b.date]))
                    .for_update()
                    .load::<models::ConfirmedShiftPlan>(conn)?
                    .into_iter()
                    .map(plan_to_domain)
                    .collect();

                let names: Vec<(Uuid, String)> = employees::table
                    .filter(employees::tenant_id.eq(&tenant_id))
                    .filter(employees::id.eq_any([a.employee_id, b.employee_id]))
                    .select((employees::id, employees::name))
                    .load(conn)?;
                let name_of = |id: Uuid| {
                    names.iter().find(|(e, _)| *e == id).map(|(_, n)| n.clone()).unwrap_or_else(|| id.to_string())
                };

                if let Some(reason) = swap_roster_conflict(&a, &b, &rows, name_of) {
                    let stale = diesel::update(shift_swap_requests::table.filter(shift_swap_requests::id.eq(id)))
                        .set((
                            shift_swap_requests::status.eq(swap_status::STALE),
                            shift_swap_requests::decided_by.eq(&decided_by),
                            shift_swap_requests::updated_at.eq(diesel::dsl::now),
                        ))
                        .get_result::<models::ShiftSwapRequest>(conn)?;
                    return Ok(SwapApproval::Stale(to_domain(stale), reason));
                }

                let row = |employee_id: Uuid, date: NaiveDate| {
                    rows.iter().find(|r| r.employee_id == employee_id && r.date == date)
                };
                // swap_roster_conflict has just made sure both exist.
                let row_a = row(a.employee_id, a.date).ok_or(AppError::Internal)?;
                let row_b = row(b.employee_id, b.date).ok_or(AppError::Internal)?;
                let now = Utc::now().naive_utc();
                let cells = [(a.employee_id, a.date), (a.employee_id, b.date), (b.employee_id, a.date), (b.employee_id, b.date)];

                rostertracking::guarded(conn, &tenant_id, &ctx, &cells, |conn| {
                if a.date == b.date {
                    // Same day: each row keeps its owner and takes the other's shift.
                    for (target, side) in [(row_a, &b), (row_b, &a)] {
                        diesel::update(confirmed_shift_plans::table.filter(confirmed_shift_plans::id.eq(target.id)))
                            .set((
                                confirmed_shift_plans::shift_id.eq(Some(side.shift_id)),
                                confirmed_shift_plans::workstation_id.eq(side.workstation_id),
                                confirmed_shift_plans::updated_at.eq(now),
                            ))
                            .execute(conn)?;
                    }
                } else {
                    // Different days: the shift rows change owner, and so do the
                    // free-day rows they displace (one row per person and day).
                    let free_b_on_a = row(b.employee_id, a.date).cloned();
                    let free_a_on_b = row(a.employee_id, b.date).cloned();
                    let displaced: Vec<Uuid> = [&free_b_on_a, &free_a_on_b].iter().filter_map(|r| r.as_ref().map(|r| r.id)).collect();
                    diesel::delete(confirmed_shift_plans::table.filter(confirmed_shift_plans::id.eq_any(&displaced)))
                        .execute(conn)?;
                    for (target, new_owner) in [(row_a, b.employee_id), (row_b, a.employee_id)] {
                        diesel::update(confirmed_shift_plans::table.filter(confirmed_shift_plans::id.eq(target.id)))
                            .set((
                                confirmed_shift_plans::employee_id.eq(new_owner),
                                confirmed_shift_plans::updated_at.eq(now),
                            ))
                            .execute(conn)?;
                    }
                    let freed: Vec<models::NewConfirmedShiftPlan> = [(free_b_on_a, a.employee_id), (free_a_on_b, b.employee_id)]
                        .into_iter()
                        .filter_map(|(free, new_owner)| free.map(|f| models::NewConfirmedShiftPlan {
                            employee_id: new_owner,
                            shift_id: None,
                            workstation_id: None,
                            date: f.date,
                            is_present: f.is_present,
                            absence_type: f.absence_type,
                            creation_type: f.creation_type,
                            tenant_id: tenant_id.clone(),
                        }))
                        .collect();
                    if !freed.is_empty() {
                        diesel::insert_into(confirmed_shift_plans::table).values(&freed).execute(conn)?;
                    }
                }
                Ok(())
                })?;

                let approved = diesel::update(shift_swap_requests::table.filter(shift_swap_requests::id.eq(id)))
                    .set((
                        shift_swap_requests::status.eq(swap_status::APPROVED),
                        shift_swap_requests::decided_by.eq(&decided_by),
                        shift_swap_requests::updated_at.eq(diesel::dsl::now),
                    ))
                    .get_result::<models::ShiftSwapRequest>(conn)?;
                Ok(SwapApproval::Approved(to_domain(approved)))
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
