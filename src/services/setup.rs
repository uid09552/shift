//! First-run setup: how far a tenant has come towards a first plan, and an
//! optional set of sample data to try the planner with.
//!
//! The steps follow the order the planner needs them in: shifts, capabilities,
//! workstations, employees, planner settings, a first plan. The UI shows them as
//! a checklist to admins while one is missing.

use axum::{extract::State, Json};
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Bool, Text};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::shift_swap::actor_name;
use crate::services::tenant::{RoleContext, TenantContext, UserContext};
use crate::telemetry;

#[derive(QueryableByName, Debug, Default, Clone, Copy)]
pub struct SetupCounts {
    #[diesel(sql_type = BigInt)]
    pub shifts: i64,
    /// Shifts with at least one weekday time: one without is never planned.
    #[diesel(sql_type = BigInt)]
    pub shifts_with_times: i64,
    #[diesel(sql_type = BigInt)]
    pub capabilities: i64,
    #[diesel(sql_type = BigInt)]
    pub workstations: i64,
    #[diesel(sql_type = BigInt)]
    pub employees: i64,
    #[diesel(sql_type = Bool)]
    pub planner_settings: bool,
    #[diesel(sql_type = BigInt)]
    pub plan_runs: i64,
    #[diesel(sql_type = BigInt)]
    pub roster_entries: i64,
}

const COUNTS: &str = "SELECT
    (SELECT count(*) FROM shifts WHERE tenant_id = $1) AS shifts,
    (SELECT count(DISTINCT shift_id) FROM shift_weekday_times WHERE tenant_id = $1) AS shifts_with_times,
    (SELECT count(*) FROM capabilities WHERE tenant_id = $1) AS capabilities,
    (SELECT count(*) FROM workstations WHERE tenant_id = $1) AS workstations,
    (SELECT count(*) FROM employees WHERE tenant_id = $1) AS employees,
    EXISTS (SELECT 1 FROM planner_settings WHERE tenant_id = $1) AS planner_settings,
    (SELECT count(*) FROM planning_tasks WHERE tenant_id = $1) AS plan_runs,
    (SELECT count(*) FROM confirmed_shift_plans WHERE tenant_id = $1 AND shift_id IS NOT NULL) AS roster_entries";

/// The checklist, in order: each step with its count and whether it is done.
pub fn steps(c: &SetupCounts) -> Vec<Value> {
    let step = |id: &str, count: i64, done: bool| json!({"id": id, "count": count, "done": done});
    vec![
        step("shifts", c.shifts, c.shifts > 0 && c.shifts_with_times > 0),
        step("capabilities", c.capabilities, c.capabilities > 0),
        step("workstations", c.workstations, c.workstations > 0),
        step("employees", c.employees, c.employees > 0),
        step("planner_settings", i64::from(c.planner_settings), c.planner_settings),
        step("first_plan", c.plan_runs + c.roster_entries, c.plan_runs > 0 || c.roster_entries > 0),
    ]
}

async fn counts(state: &AppState, tenant: &str) -> Result<SetupCounts, AppError> {
    let tenant = tenant.to_string();
    let pool = std::sync::Arc::clone(&state.pool);
    telemetry::db_blocking(move || {
        let mut conn = pool.get().map_err(|_| AppError::DbError)?;
        diesel::sql_query(COUNTS)
            .bind::<Text, _>(&tenant)
            .get_result::<SetupCounts>(&mut conn)
            .map_err(|_| AppError::DbError)
    })
    .await
    .map_err(|_| AppError::Internal)?
}

fn status_json(c: &SetupCounts) -> Value {
    let steps = steps(c);
    let complete = steps.iter().all(|s| s["done"] == json!(true));
    // Sample data only goes into an empty tenant, never next to real data.
    let empty = c.shifts == 0 && c.capabilities == 0 && c.workstations == 0 && c.employees == 0;
    json!({"steps": steps, "complete": complete, "sample_data_available": empty})
}

/// Early / Late / Night every day, two wards with one capability each, eight people.
const SAMPLE_SHIFTS: [(&str, &str, &str, &str, &str); 3] = [
    ("Early", "E", "#3B82F6", "06:00", "14:00"),
    ("Late", "L", "#F59E0B", "14:00", "22:00"),
    ("Night", "N", "#6366F1", "22:00", "06:00"),
];
const SAMPLE_CAPABILITIES: [&str; 2] = ["General care", "Intensive care"];
/// Name, priority, index of the capability it requires.
const SAMPLE_WORKSTATIONS: [(&str, &str, usize); 2] = [("Ward A", "medium", 0), ("ICU", "high", 1)];
/// Name, the capabilities they hold.
const SAMPLE_EMPLOYEES: [(&str, &[usize]); 8] = [
    ("Anna Sample", &[0, 1]),
    ("Ben Sample", &[0]),
    ("Clara Sample", &[0, 1]),
    ("David Sample", &[0]),
    ("Eva Sample", &[0, 1]),
    ("Felix Sample", &[0]),
    ("Greta Sample", &[0, 1]),
    ("Hannes Sample", &[0]),
];

fn insert_sample_data(conn: &mut PgConnection, tenant: &str) -> Result<(), diesel::result::Error> {
    use diesel::sql_types::{Array, Uuid as SqlUuid};
    let shift_ids: Vec<Uuid> = SAMPLE_SHIFTS.iter().map(|_| Uuid::new_v4()).collect();
    for (order, ((name, short, color, start, end), id)) in SAMPLE_SHIFTS.iter().zip(&shift_ids).enumerate() {
        diesel::sql_query(
            "INSERT INTO shifts (id, name, short_name, color, \"order\", tenant_id) VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind::<SqlUuid, _>(id)
        .bind::<Text, _>(*name)
        .bind::<Text, _>(*short)
        .bind::<Text, _>(*color)
        .bind::<diesel::sql_types::Integer, _>(order as i32)
        .bind::<Text, _>(tenant)
        .execute(conn)?;
        diesel::sql_query(
            "INSERT INTO shift_weekday_times (shift_id, weekday, start_time, end_time, min_employees, tenant_id)
             SELECT $1, wd, $2::time, $3::time, 1, $4 FROM generate_series(0, 6) AS wd",
        )
        .bind::<SqlUuid, _>(id)
        .bind::<Text, _>(*start)
        .bind::<Text, _>(*end)
        .bind::<Text, _>(tenant)
        .execute(conn)?;
    }
    let capability_ids: Vec<Uuid> = SAMPLE_CAPABILITIES.iter().map(|_| Uuid::new_v4()).collect();
    for (name, id) in SAMPLE_CAPABILITIES.iter().zip(&capability_ids) {
        diesel::sql_query("INSERT INTO capabilities (id, name, tenant_id) VALUES ($1, $2, $3)")
            .bind::<SqlUuid, _>(id)
            .bind::<Text, _>(*name)
            .bind::<Text, _>(tenant)
            .execute(conn)?;
    }
    for (name, priority, capability) in SAMPLE_WORKSTATIONS {
        let id = Uuid::new_v4();
        diesel::sql_query(
            "INSERT INTO workstations (id, name, available, active_shift_ids, priority, min_employees, tenant_id)
             VALUES ($1, $2, true, $3, $4, 1, $5)",
        )
        .bind::<SqlUuid, _>(id)
        .bind::<Text, _>(name)
        .bind::<Array<SqlUuid>, _>(&shift_ids)
        .bind::<Text, _>(priority)
        .bind::<Text, _>(tenant)
        .execute(conn)?;
        diesel::sql_query("INSERT INTO workstation_required_capabilities (workstation_id, capability_id, tenant_id) VALUES ($1, $2, $3)")
            .bind::<SqlUuid, _>(id)
            .bind::<SqlUuid, _>(capability_ids[capability])
            .bind::<Text, _>(tenant)
            .execute(conn)?;
    }
    for (name, held) in SAMPLE_EMPLOYEES {
        let id = Uuid::new_v4();
        let email = format!("{}@example.invalid", name.to_lowercase().replace(' ', "."));
        diesel::sql_query("INSERT INTO employees (id, name, email, tenant_id) VALUES ($1, $2, $3, $4)")
            .bind::<SqlUuid, _>(id)
            .bind::<Text, _>(name)
            .bind::<Text, _>(&email)
            .bind::<Text, _>(tenant)
            .execute(conn)?;
        for shift in &shift_ids {
            diesel::sql_query("INSERT INTO employee_available_shifts (employee_id, shift_id, tenant_id) VALUES ($1, $2, $3)")
                .bind::<SqlUuid, _>(id)
                .bind::<SqlUuid, _>(shift)
                .bind::<Text, _>(tenant)
                .execute(conn)?;
        }
        for &capability in held {
            diesel::sql_query("INSERT INTO employee_capabilities (employee_id, capability_id, tenant_id) VALUES ($1, $2, $3)")
                .bind::<SqlUuid, _>(id)
                .bind::<SqlUuid, _>(capability_ids[capability])
                .bind::<Text, _>(tenant)
                .execute(conn)?;
        }
    }
    Ok(())
}

pub struct SetupService;

impl SetupService {
    /// GET /setup-status — the first-run checklist of the caller's tenant.
    pub async fn status(tenant: TenantContext, State(state): State<AppState>) -> Result<Json<Value>, AppError> {
        Ok(Json(status_json(&counts(&state, &tenant.0).await?)))
    }

    /// POST /setup/sample-data — fills an empty tenant with sample shifts,
    /// capabilities, workstations and employees (`shift-admin` only). 409 once
    /// the tenant has any of them, so it never mixes with real data.
    pub async fn sample_data(
        tenant: TenantContext,
        roles: RoleContext,
        user: UserContext,
        actor: AuditActor,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        if !roles.is_admin() {
            return Err(AppError::Forbidden("Only an admin may load sample data".into()));
        }
        let tenant_id = tenant.0.clone();
        let pool = std::sync::Arc::clone(&state.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                // Serialise concurrent clicks per tenant, then check emptiness inside the lock.
                diesel::sql_query("SELECT pg_advisory_xact_lock(hashtext('setup-sample:' || $1))")
                    .bind::<Text, _>(&tenant_id)
                    .execute(conn)
                    .map_err(|_| AppError::DbError)?;
                let c = diesel::sql_query(COUNTS)
                    .bind::<Text, _>(&tenant_id)
                    .get_result::<SetupCounts>(conn)
                    .map_err(|_| AppError::DbError)?;
                if c.shifts + c.capabilities + c.workstations + c.employees > 0 {
                    return Err(AppError::Conflict(
                        "Sample data only goes into an empty organization; this one already has shifts, capabilities, workstations or employees".into(),
                    ));
                }
                insert_sample_data(conn, &tenant_id).map_err(|_| AppError::DbError)
            })
        })
        .await
        .map_err(|_| AppError::Internal)??;
        audit_log::record(&state, &tenant.0, actor_name(&actor, &user), "setup.sample_data", "setup", None, Some(json!({"name": "sample data"}).to_string())).await;
        Ok(Json(status_json(&counts(&state, &tenant.0).await?)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shift_without_times_is_not_a_finished_step() {
        let c = SetupCounts { shifts: 2, ..Default::default() };
        assert_eq!(steps(&c)[0]["done"], json!(false));
        let c = SetupCounts { shifts: 2, shifts_with_times: 1, ..Default::default() };
        assert_eq!(steps(&c)[0]["done"], json!(true));
    }

    #[test]
    fn a_plan_run_or_a_roster_entry_is_a_first_plan() {
        let done = |c: SetupCounts| steps(&c)[5]["done"] == json!(true);
        assert!(!done(SetupCounts::default()));
        assert!(done(SetupCounts { plan_runs: 1, ..Default::default() }));
        assert!(done(SetupCounts { roster_entries: 3, ..Default::default() }));
    }

    #[test]
    fn sample_data_is_offered_to_an_empty_tenant_only() {
        assert_eq!(status_json(&SetupCounts::default())["sample_data_available"], json!(true));
        let some = SetupCounts { employees: 1, ..Default::default() };
        assert_eq!(status_json(&some)["sample_data_available"], json!(false));
        assert_eq!(status_json(&some)["complete"], json!(false));
    }
}
