use async_trait::async_trait;
use chrono::NaiveDate;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{
    self as models, LeaveBlackout, LeaveLimit, LeaveRequest, NewLeaveBlackout, NewLeaveRequest, NewUnavailability,
};
use crate::repository::domain::{leave_status, LeaveFilter, LeaveRepository};
use crate::repository::rostertracking::{self, Cell};
use crate::schema::{
    confirmed_shift_plans, leave_blackouts, leave_limits, leave_request_days, leave_requests, unavailabilities,
};
use crate::services::roster_guard::RosterChangeCtx;
use crate::telemetry;

/// The `absence_type` a leave day is mirrored into the roster as — the one a
/// plain unavailability uses, so the calendar shows it the same way.
const MIRROR_ABSENCE: &str = "unavailable";

/// Every day from `start` to `end`, inclusive.
pub fn days_of(start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let mut days = Vec::new();
    let mut day = start;
    while day <= end {
        days.push(day);
        day = day.succ_opt().expect("date in range");
    }
    days
}

#[derive(Clone)]
pub struct DieselLeaveRepository {
    pub pool: Arc<DbPool>,
}

/// Locks the request and checks it is in `expected`.
fn lock_in_state(
    conn: &mut PgConnection,
    tenant_id: &str,
    id: Uuid,
    expected: &str,
) -> Result<LeaveRequest, AppError> {
    let leave = leave_requests::table
        .filter(leave_requests::id.eq(id))
        .filter(leave_requests::tenant_id.eq(tenant_id))
        .for_update()
        .first::<LeaveRequest>(conn)
        .optional()?
        .ok_or(AppError::NotFound)?;
    if leave.status != expected {
        return Err(AppError::Conflict(format!("This leave request is already {}", leave.status)));
    }
    Ok(leave)
}

fn finish(
    conn: &mut PgConnection,
    id: Uuid,
    to: &str,
    decided_by: &Option<String>,
    comment: &Option<String>,
) -> Result<LeaveRequest, AppError> {
    Ok(diesel::update(leave_requests::table.filter(leave_requests::id.eq(id)))
        .set((
            leave_requests::status.eq(to),
            leave_requests::decided_by.eq(decided_by),
            leave_requests::decision_comment.eq(comment),
            leave_requests::updated_at.eq(diesel::dsl::now),
        ))
        .get_result::<LeaveRequest>(conn)?)
}

#[async_trait]
impl LeaveRepository for DieselLeaveRepository {
    async fn create_leave(&self, tenant_id: &str, mut leave: NewLeaveRequest) -> Result<LeaveRequest, AppError> {
        leave.tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(leave_requests::table)
                .values(&leave)
                .get_result::<LeaveRequest>(&mut conn)
                .map_err(AppError::from)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_leave(&self, tenant_id: &str, id: Uuid) -> Result<Option<LeaveRequest>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            leave_requests::table
                .filter(leave_requests::id.eq(id))
                .filter(leave_requests::tenant_id.eq(&tenant_id))
                .first::<LeaveRequest>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn list_leave(&self, tenant_id: &str, filter: LeaveFilter) -> Result<Vec<LeaveRequest>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = leave_requests::table
                .filter(leave_requests::tenant_id.eq(&tenant_id))
                .order((leave_requests::start_date.desc(), leave_requests::created_at.desc()))
                .into_boxed();
            if let Some(employee_id) = filter.employee_id {
                query = query.filter(leave_requests::employee_id.eq(employee_id));
            }
            if !filter.statuses.is_empty() {
                query = query.filter(leave_requests::status.eq_any(filter.statuses));
            }
            if let Some(from) = filter.from {
                query = query.filter(leave_requests::end_date.ge(from));
            }
            if let Some(to) = filter.to {
                query = query.filter(leave_requests::start_date.le(to));
            }
            query.load::<LeaveRequest>(&mut conn).map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn count_leave_with_status(&self, tenant_id: &str, status: &str) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let status = status.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            leave_requests::table
                .filter(leave_requests::tenant_id.eq(&tenant_id))
                .filter(leave_requests::status.eq(&status))
                .count()
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn transition_leave(
        &self,
        tenant_id: &str,
        id: Uuid,
        from: &[&str],
        to: &str,
        decided_by: Option<String>,
        comment: Option<String>,
    ) -> Result<Option<LeaveRequest>, AppError> {
        let tenant_id = tenant_id.to_string();
        let from: Vec<String> = from.iter().map(|s| s.to_string()).collect();
        let to = to.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            // The status filter makes check and write one statement, so two
            // decisions racing for the same request cannot both win.
            diesel::update(
                leave_requests::table
                    .filter(leave_requests::id.eq(id))
                    .filter(leave_requests::tenant_id.eq(&tenant_id))
                    .filter(leave_requests::status.eq_any(&from)),
            )
            .set((
                leave_requests::status.eq(&to),
                leave_requests::decided_by.eq(&decided_by),
                leave_requests::decision_comment.eq(&comment),
                leave_requests::updated_at.eq(diesel::dsl::now),
            ))
            .get_result::<LeaveRequest>(&mut conn)
            .optional()
            .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn approve_leave(
        &self,
        tenant_id: &str,
        id: Uuid,
        decided_by: Option<String>,
        comment: Option<String>,
        ctx: &RosterChangeCtx,
    ) -> Result<LeaveRequest, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        let ctx = ctx.clone();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                let leave = lock_in_state(conn, &tenant_id, id, leave_status::PENDING)?;
                let days = days_of(leave.start_date, leave.end_date);
                let cells: Vec<Cell> = days.iter().map(|d| (leave.employee_id, *d)).collect();

                rostertracking::guarded(conn, &tenant_id, &ctx, &cells, |conn| {
                    for day in &days {
                        // Already absent that day (hard, whole day): nothing of
                        // ours to add — and so nothing a revoke may remove.
                        let absent: i64 = unavailabilities::table
                            .filter(unavailabilities::tenant_id.eq(&tenant_id))
                            .filter(unavailabilities::employee_id.eq(leave.employee_id))
                            .filter(unavailabilities::unavailable_date.eq(*day))
                            .filter(unavailabilities::shift_id.is_null())
                            .filter(unavailabilities::is_soft_preference.eq(false))
                            .count()
                            .get_result(conn)?;
                        if absent > 0 {
                            continue;
                        }
                        let unavailability_id: Uuid = diesel::insert_into(unavailabilities::table)
                            .values(NewUnavailability {
                                employee_id: leave.employee_id,
                                unavailable_date: *day,
                                shift_id: None,
                                tenant_id: tenant_id.clone(),
                                is_soft_preference: false,
                            })
                            .returning(unavailabilities::id)
                            .get_result(conn)?;
                        diesel::insert_into(leave_request_days::table)
                            .values((
                                leave_request_days::leave_request_id.eq(id),
                                leave_request_days::unavailability_id.eq(unavailability_id),
                                leave_request_days::date.eq(*day),
                            ))
                            .execute(conn)?;

                        // The roster mirror. A day already marked sick (or any
                        // other absence) keeps its entry; a planned shift or a
                        // free day makes way for the leave.
                        let current: Option<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
                            .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                            .filter(confirmed_shift_plans::employee_id.eq(leave.employee_id))
                            .filter(confirmed_shift_plans::date.eq(*day))
                            .first(conn)
                            .optional()?;
                        let keeps = current
                            .as_ref()
                            .and_then(|r| r.absence_type.as_deref())
                            .is_some_and(|a| a != "free");
                        if keeps {
                            continue;
                        }
                        diesel::insert_into(confirmed_shift_plans::table)
                            .values(models::NewConfirmedShiftPlan {
                                employee_id: leave.employee_id,
                                shift_id: None,
                                workstation_id: None,
                                date: *day,
                                is_present: false,
                                absence_type: Some(MIRROR_ABSENCE.to_string()),
                                creation_type: "manual".to_string(),
                                tenant_id: tenant_id.clone(),
                            })
                            .on_conflict((
                                confirmed_shift_plans::tenant_id,
                                confirmed_shift_plans::employee_id,
                                confirmed_shift_plans::date,
                            ))
                            .do_update()
                            .set((
                                confirmed_shift_plans::shift_id.eq(None::<Uuid>),
                                confirmed_shift_plans::workstation_id.eq(None::<Uuid>),
                                confirmed_shift_plans::is_present.eq(false),
                                confirmed_shift_plans::absence_type.eq(Some(MIRROR_ABSENCE)),
                                confirmed_shift_plans::creation_type.eq("manual"),
                                confirmed_shift_plans::updated_at.eq(diesel::dsl::now),
                            ))
                            .execute(conn)?;
                    }
                    Ok(())
                })?;

                finish(conn, id, leave_status::APPROVED, &decided_by, &comment)
            })
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn revoke_leave(
        &self,
        tenant_id: &str,
        id: Uuid,
        decided_by: Option<String>,
        comment: Option<String>,
        ctx: &RosterChangeCtx,
    ) -> Result<LeaveRequest, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        let ctx = ctx.clone();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                let leave = lock_in_state(conn, &tenant_id, id, leave_status::APPROVED)?;
                // Days that have passed stay as they were: they happened.
                let days: Vec<(Uuid, NaiveDate)> = leave_request_days::table
                    .filter(leave_request_days::leave_request_id.eq(id))
                    .filter(leave_request_days::date.ge(ctx.today))
                    .select((leave_request_days::unavailability_id, leave_request_days::date))
                    .load(conn)?;
                let cells: Vec<Cell> = days.iter().map(|(_, d)| (leave.employee_id, *d)).collect();

                rostertracking::guarded(conn, &tenant_id, &ctx, &cells, |conn| {
                    for (unavailability_id, day) in &days {
                        diesel::delete(
                            confirmed_shift_plans::table
                                .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                                .filter(confirmed_shift_plans::employee_id.eq(leave.employee_id))
                                .filter(confirmed_shift_plans::date.eq(*day))
                                .filter(confirmed_shift_plans::absence_type.eq(MIRROR_ABSENCE)),
                        )
                        .execute(conn)?;
                        // Takes the leave_request_days row with it (cascade).
                        diesel::delete(unavailabilities::table.filter(unavailabilities::id.eq(*unavailability_id)))
                            .execute(conn)?;
                    }
                    Ok(())
                })?;

                finish(conn, id, leave_status::REVOKED, &decided_by, &comment)
            })
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn list_blackouts(&self, tenant_id: &str) -> Result<Vec<LeaveBlackout>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            leave_blackouts::table
                .filter(leave_blackouts::tenant_id.eq(&tenant_id))
                .order(leave_blackouts::start_date.asc())
                .load::<LeaveBlackout>(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn create_blackout(&self, tenant_id: &str, mut blackout: NewLeaveBlackout) -> Result<LeaveBlackout, AppError> {
        blackout.tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(leave_blackouts::table)
                .values(&blackout)
                .get_result::<LeaveBlackout>(&mut conn)
                .map_err(AppError::from)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn delete_blackout(&self, tenant_id: &str, id: Uuid) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                leave_blackouts::table
                    .filter(leave_blackouts::id.eq(id))
                    .filter(leave_blackouts::tenant_id.eq(&tenant_id)),
            )
            .execute(&mut conn)
            .map(|n| n > 0)
            .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn list_limits(&self, tenant_id: &str) -> Result<Vec<LeaveLimit>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            leave_limits::table
                .filter(leave_limits::tenant_id.eq(&tenant_id))
                .load::<LeaveLimit>(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn replace_limits(&self, tenant_id: &str, limits: Vec<LeaveLimit>) -> Result<Vec<LeaveLimit>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                diesel::delete(leave_limits::table.filter(leave_limits::tenant_id.eq(&tenant_id))).execute(conn)?;
                let rows: Vec<LeaveLimit> = limits
                    .into_iter()
                    .map(|l| LeaveLimit { tenant_id: tenant_id.clone(), ..l })
                    .collect();
                if !rows.is_empty() {
                    diesel::insert_into(leave_limits::table).values(&rows).execute(conn)?;
                }
                Ok(rows)
            })
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn absences_in_range(
        &self,
        tenant_id: &str,
        employees: &[Uuid],
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<(Uuid, NaiveDate)>, AppError> {
        let tenant_id = tenant_id.to_string();
        let employees = employees.to_vec();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            unavailabilities::table
                .filter(unavailabilities::tenant_id.eq(&tenant_id))
                .filter(unavailabilities::employee_id.eq_any(&employees))
                .filter(unavailabilities::unavailable_date.between(from, to))
                .filter(unavailabilities::shift_id.is_null())
                .filter(unavailabilities::is_soft_preference.eq(false))
                .select((unavailabilities::employee_id, unavailabilities::unavailable_date))
                .distinct()
                .load(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}
