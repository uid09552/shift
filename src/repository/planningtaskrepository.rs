use std::sync::Arc;
use async_trait::async_trait;
use diesel::prelude::*;
use tokio::task;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewPlanningTask, PlanningTask};
use crate::schema::planning_tasks;
use super::domain::{PlanningTaskDomain, PlanningTaskRepository};

#[derive(Clone)]
pub struct DieselPlanningTaskRepository {
    pub pool: Arc<DbPool>,
}

fn to_domain(t: PlanningTask) -> PlanningTaskDomain {
    PlanningTaskDomain {
        id: t.id,
        status: t.status,
        payload: t.payload,
        result_id: t.result_id,
        error_message: t.error_message,
        created_at: t.created_at,
        updated_at: t.updated_at,
    }
}

#[async_trait]
impl PlanningTaskRepository for DieselPlanningTaskRepository {
    async fn create_planning_task(
        &self,
        tenant_id: &str,
        id: Uuid,
        payload: serde_json::Value,
    ) -> Result<PlanningTaskDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_task = NewPlanningTask {
                id,
                status: "scheduled".to_string(),
                payload,
                tenant_id,
            };
            let inserted: PlanningTask = diesel::insert_into(planning_tasks::table)
                .values(&new_task)
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(to_domain(inserted))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_planning_task(
        &self,
        tenant_id: &str,
        id: Uuid,
    ) -> Result<Option<PlanningTaskDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let result = planning_tasks::table
                .filter(planning_tasks::id.eq(id))
                .filter(planning_tasks::tenant_id.eq(&tenant_id))
                .first::<PlanningTask>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;
            Ok(result.map(to_domain))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_planning_tasks(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<PlanningTaskDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let results = planning_tasks::table
                .filter(planning_tasks::tenant_id.eq(&tenant_id))
                .order(planning_tasks::created_at.desc())
                .load::<PlanningTask>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(results.into_iter().map(to_domain).collect())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_planning_task_done(
        &self,
        tenant_id: &str,
        id: Uuid,
        result_id: Uuid,
    ) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                planning_tasks::table
                    .filter(planning_tasks::id.eq(id))
                    .filter(planning_tasks::tenant_id.eq(&tenant_id)),
            )
                .set((
                    planning_tasks::status.eq("done"),
                    planning_tasks::result_id.eq(Some(result_id)),
                    planning_tasks::updated_at.eq(diesel::dsl::now),
                ))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_planning_task_error(
        &self,
        tenant_id: &str,
        id: Uuid,
        error_message: String,
    ) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                planning_tasks::table
                    .filter(planning_tasks::id.eq(id))
                    .filter(planning_tasks::tenant_id.eq(&tenant_id)),
            )
                .set((
                    planning_tasks::status.eq("error"),
                    planning_tasks::error_message.eq(Some(error_message)),
                    planning_tasks::updated_at.eq(diesel::dsl::now),
                ))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_planning_task(
        &self,
        tenant_id: &str,
        id: Uuid,
    ) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let count = diesel::delete(
                planning_tasks::table
                    .filter(planning_tasks::id.eq(id))
                    .filter(planning_tasks::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            if count == 0 {
                return Err(AppError::NotFound);
            }
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn clear_task_result_id(
        &self,
        tenant_id: &str,
        result_id: Uuid,
    ) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                planning_tasks::table
                    .filter(planning_tasks::result_id.eq(Some(result_id)))
                    .filter(planning_tasks::tenant_id.eq(&tenant_id)),
            )
            .set((
                planning_tasks::result_id.eq(None::<Uuid>),
                planning_tasks::updated_at.eq(diesel::dsl::now),
            ))
            .execute(&mut conn)
            .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn mark_stale_tasks_failed(
        &self,
        cutoff: chrono::NaiveDateTime,
    ) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            let count = diesel::update(
                planning_tasks::table
                    .filter(planning_tasks::status.eq("scheduled"))
                    .filter(planning_tasks::created_at.lt(cutoff)),
            )
            .set((
                planning_tasks::status.eq("error"),
                planning_tasks::error_message.eq(Some("Task timed out (stale on startup)")),
                planning_tasks::updated_at.eq(diesel::dsl::now),
            ))
            .execute(&mut conn)?;
            Ok(count)
        })
        .await?
    }
}
