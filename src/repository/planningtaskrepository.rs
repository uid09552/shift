use std::sync::Arc;
use async_trait::async_trait;
use diesel::prelude::*;
use tokio::task;
use uuid::Uuid;

use crate::database::DbPool;
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
        id: Uuid,
        payload: serde_json::Value,
    ) -> Result<PlanningTaskDomain, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            let new_task = NewPlanningTask {
                id,
                status: "scheduled".to_string(),
                payload,
            };
            let inserted: PlanningTask = diesel::insert_into(planning_tasks::table)
                .values(&new_task)
                .get_result(&mut conn)?;
            Ok(to_domain(inserted))
        })
        .await?
    }

    async fn get_planning_task(
        &self,
        id: Uuid,
    ) -> Result<Option<PlanningTaskDomain>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            let result = planning_tasks::table
                .find(id)
                .first::<PlanningTask>(&mut conn)
                .optional()?;
            Ok(result.map(to_domain))
        })
        .await?
    }

    async fn list_planning_tasks(
        &self,
    ) -> Result<Vec<PlanningTaskDomain>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            let results = planning_tasks::table
                .order(planning_tasks::created_at.desc())
                .load::<PlanningTask>(&mut conn)?;
            Ok(results.into_iter().map(to_domain).collect())
        })
        .await?
    }

    async fn update_planning_task_done(
        &self,
        id: Uuid,
        result_id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            diesel::update(planning_tasks::table.find(id))
                .set((
                    planning_tasks::status.eq("done"),
                    planning_tasks::result_id.eq(Some(result_id)),
                    planning_tasks::updated_at.eq(diesel::dsl::now),
                ))
                .execute(&mut conn)?;
            Ok(())
        })
        .await?
    }

    async fn update_planning_task_error(
        &self,
        id: Uuid,
        error_message: String,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            diesel::update(planning_tasks::table.find(id))
                .set((
                    planning_tasks::status.eq("error"),
                    planning_tasks::error_message.eq(Some(error_message)),
                    planning_tasks::updated_at.eq(diesel::dsl::now),
                ))
                .execute(&mut conn)?;
            Ok(())
        })
        .await?
    }

    async fn delete_planning_task(
        &self,
        id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            let count = diesel::delete(planning_tasks::table.find(id))
                .execute(&mut conn)?;
            if count == 0 {
                return Err(Box::new(crate::errors::AppError::NotFound) as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(())
        })
        .await?
    }

    async fn clear_task_result_id(
        &self,
        result_id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            diesel::update(
                planning_tasks::table.filter(planning_tasks::result_id.eq(Some(result_id))),
            )
            .set((
                planning_tasks::result_id.eq(None::<Uuid>),
                planning_tasks::updated_at.eq(diesel::dsl::now),
            ))
            .execute(&mut conn)?;
            Ok(())
        })
        .await?
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
