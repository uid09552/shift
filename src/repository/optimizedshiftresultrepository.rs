use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use tokio::task;
use uuid::Uuid;
use crate::errors::AppError;

use crate::database::DbPool;
use crate::repository::domain::{
    OptimizedShiftResultDomain, OptimizedShiftResultRepository,
};
use crate::models as models;
use crate::schema::{optimized_shift_results, planning_tasks};

#[derive(Clone)]
pub struct DieselOptimizedShiftResultRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl OptimizedShiftResultRepository for DieselOptimizedShiftResultRepository {
    async fn create_optimized_shift_result(
        &self,
        tenant_id: &str,
        result: serde_json::Value,
    ) -> Result<OptimizedShiftResultDomain, AppError> {
        let pool = Arc::clone(&self.pool);
        let new_result = models::NewOptimizedShiftResult {
            result,
            tenant_id: tenant_id.to_string(),
        };
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(optimized_shift_results::table)
                .values(&new_result)
                .get_result::<models::OptimizedShiftResult>(&mut conn)
                .map(|r| OptimizedShiftResultDomain {
                    id: r.id,
                    result: r.result,
                    creation_date: r.creation_date,
                })
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_optimized_shift_result_by_id(
        &self,
        tenant_id: &str,
        id: Uuid,
    ) -> Result<Option<OptimizedShiftResultDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            optimized_shift_results::table
                .filter(optimized_shift_results::id.eq(id))
                .filter(optimized_shift_results::tenant_id.eq(&tenant_id))
                .first::<models::OptimizedShiftResult>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)
                .map(|opt| opt.map(|r| OptimizedShiftResultDomain {
                    id: r.id,
                    result: r.result,
                    creation_date: r.creation_date,
                }))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_latest_optimized_shift_result(
        &self,
        tenant_id: &str,
    ) -> Result<Option<OptimizedShiftResultDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            optimized_shift_results::table
                .filter(optimized_shift_results::tenant_id.eq(&tenant_id))
                .order(optimized_shift_results::creation_date.desc())
                .first::<models::OptimizedShiftResult>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)
                .map(|opt| opt.map(|r| OptimizedShiftResultDomain {
                    id: r.id,
                    result: r.result,
                    creation_date: r.creation_date,
                }))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_optimized_shift_results(
        &self,
        tenant_id: &str,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<OptimizedShiftResultDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = optimized_shift_results::table
                .filter(optimized_shift_results::tenant_id.eq(tenant_id))
                .order(optimized_shift_results::creation_date.desc())
                .into_boxed();
            if let Some(l) = limit {
                query = query.limit(l);
            }
            if let Some(o) = offset {
                query = query.offset(o);
            }
            query
                .load::<models::OptimizedShiftResult>(&mut conn)
                .map(|results: Vec<models::OptimizedShiftResult>| {
                    results
                        .into_iter()
                        .map(|r| OptimizedShiftResultDomain {
                            id: r.id,
                            result: r.result,
                            creation_date: r.creation_date,
                        })
                        .collect()
                })
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn count_optimized_shift_results(
        &self,
        tenant_id: &str,
    ) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            optimized_shift_results::table
                .filter(optimized_shift_results::tenant_id.eq(tenant_id))
                .count()
                .first(&mut conn)
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_optimized_shift_result(
        &self,
        tenant_id: &str,
        id: Uuid,
        result: serde_json::Value,
    ) -> Result<OptimizedShiftResultDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                optimized_shift_results::table
                    .filter(optimized_shift_results::id.eq(id))
                    .filter(optimized_shift_results::tenant_id.eq(&tenant_id)),
            )
            .set(optimized_shift_results::result.eq(result))
            .get_result::<models::OptimizedShiftResult>(&mut conn)
            .optional()
            .map_err(|_| AppError::DbError)?
            .map(|r| OptimizedShiftResultDomain {
                id: r.id,
                result: r.result,
                creation_date: r.creation_date,
            })
            .ok_or(AppError::NotFound)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_optimized_shift_result(
        &self,
        tenant_id: &str,
        id: Uuid,
    ) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, AppError, _>(|conn| {
                // Detach any planning tasks that reference this result before deleting
                diesel::update(
                    planning_tasks::table
                        .filter(planning_tasks::result_id.eq(Some(id)))
                        .filter(planning_tasks::tenant_id.eq(&tenant_id)),
                )
                .set(planning_tasks::result_id.eq(None::<Uuid>))
                .execute(conn)
                .map_err(|_| AppError::DbError)?;

                let count = diesel::delete(
                    optimized_shift_results::table
                        .filter(optimized_shift_results::id.eq(id))
                        .filter(optimized_shift_results::tenant_id.eq(&tenant_id)),
                )
                    .execute(conn)
                    .map_err(|_| AppError::DbError)?;
                if count == 0 {
                    return Err(AppError::NotFound);
                }
                Ok(())
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
