//! A plan result belongs to the tenant that asked for the run.
//!
//! The solver's answer carries only the task id, so the backend has to look the
//! task up to learn whose it is. These feed `handle_result_message` crafted
//! answers for tasks of another tenant than the server's default one.
//!
//! Needs PostgreSQL; with none reachable the tests print a notice and pass, as
//! in `planner_settings.rs`.

use std::sync::Arc;
use std::time::Duration;

use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::json;
use uuid::Uuid;

use shift::database::DbPool;
use shift::repository::domain::{OptimizedShiftResultRepository, PlanningTaskRepository};
use shift::repository::AppState;
use shift::schema::{optimized_shift_results, planning_tasks};
use shift::services::optimizer::handle_result_message;

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

struct Env {
    state: AppState,
    pool: DbPool,
    tenant: String,
}

impl Env {
    fn spawn() -> Option<Self> {
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(ConnectionManager::<PgConnection>::new(url))
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping plan-result tests: no database ({e})");
                return None;
            }
        };
        shift::database::run_migrations(&pool).expect("migrations");
        let state = AppState::new(Arc::new(pool.clone()));
        Some(Self { state, pool, tenant: format!("test-results-{}", Uuid::new_v4()) })
    }

    async fn task(&self, tenant: &str, source: &str) -> Uuid {
        let id = Uuid::new_v4();
        self.state.planning_task_repo.create_planning_task(tenant, id, json!({}), source).await.expect("task");
        id
    }

    fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let _ = diesel::delete(optimized_shift_results::table.filter(optimized_shift_results::tenant_id.eq(&self.tenant)))
            .execute(&mut conn);
        let _ = diesel::delete(planning_tasks::table.filter(planning_tasks::tenant_id.eq(&self.tenant))).execute(&mut conn);
    }
}

fn answer(job_id: Uuid) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "job_id": job_id.to_string(),
        "status": "optimal",
        "objective_value": 1.0,
        "planning_period": { "start_date": "2099-01-01", "end_date": "2099-01-07" },
        "message": null,
    }))
    .unwrap()
}

fn solver_error(job_id: Uuid) -> Vec<u8> {
    serde_json::to_vec(&json!({ "job_id": job_id.to_string(), "status": "error", "message": "boom" })).unwrap()
}

#[tokio::test]
async fn another_tenants_result_completes_that_tenants_task() {
    let Some(env) = Env::spawn() else { return };
    let task = env.task(&env.tenant, "manual").await;

    handle_result_message(env.state.clone(), &answer(task)).await.expect("handled");

    let stored = env.state.planning_task_repo.get_planning_task(&env.tenant, task).await.unwrap().expect("task");
    assert_eq!(stored.status, "done", "the asker's task completes, not a default-tenant lookup that misses");
    let result_id = stored.result_id.expect("result id");
    assert!(env.state.optimized_shift_result_repo.get_optimized_shift_result_by_id(&env.tenant, result_id).await.unwrap().is_some());
    assert!(
        env.state
            .optimized_shift_result_repo
            .get_optimized_shift_result_by_id(&env.state.default_tenant_id, result_id)
            .await
            .unwrap()
            .is_none(),
        "and the default tenant does not see it"
    );
    assert!(env.state.planning_task_repo.get_planning_task(&env.state.default_tenant_id, task).await.unwrap().is_none());

    env.cleanup();
}

#[tokio::test]
async fn another_tenants_solver_error_fails_that_tenants_task() {
    let Some(env) = Env::spawn() else { return };
    let task = env.task(&env.tenant, "manual").await;

    handle_result_message(env.state.clone(), &solver_error(task)).await.expect("handled");

    let stored = env.state.planning_task_repo.get_planning_task(&env.tenant, task).await.unwrap().expect("task");
    assert_eq!(stored.status, "error");
    assert_eq!(stored.error_message.as_deref(), Some("boom"));

    env.cleanup();
}

#[tokio::test]
async fn the_stored_result_remembers_how_the_run_started() {
    let Some(env) = Env::spawn() else { return };
    let manual = env.task(&env.tenant, "manual").await;
    let auto = env.task(&env.tenant, "auto").await;
    handle_result_message(env.state.clone(), &answer(manual)).await.unwrap();
    handle_result_message(env.state.clone(), &answer(auto)).await.unwrap();

    let source_of = |id: Uuid| {
        let env = &env;
        async move {
            let task = env.state.planning_task_repo.get_planning_task(&env.tenant, id).await.unwrap().unwrap();
            let result = env
                .state
                .optimized_shift_result_repo
                .get_optimized_shift_result_by_id(&env.tenant, task.result_id.unwrap())
                .await
                .unwrap()
                .unwrap();
            result.result["source"].as_str().map(str::to_string)
        }
    };
    assert_eq!(source_of(manual).await.as_deref(), Some("manual"));
    assert_eq!(source_of(auto).await.as_deref(), Some("auto"));

    env.cleanup();
}
