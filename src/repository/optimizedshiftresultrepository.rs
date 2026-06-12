use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use tokio::task;
use uuid::Uuid;
use crate::errors::AppError;
use diesel::result::Error as DieselError;

use crate::database::DbPool;
use crate::repository::domain::{
    OptimizedShiftResultDomain, OptimizedShiftResultRepository,
};
use crate::models as models;
use crate::schema::optimized_shift_results;

#[derive(Clone)]
pub struct DieselOptimizedShiftResultRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl OptimizedShiftResultRepository for DieselOptimizedShiftResultRepository {
    async fn create_optimized_shift_result(
        &self,
        result: serde_json::Value,
    ) -> Result<OptimizedShiftResultDomain, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        let new_result = models::NewOptimizedShiftResult {
            result,
        };
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::insert_into(optimized_shift_results::table)
                .values(&new_result)
                .get_result::<models::OptimizedShiftResult>(&mut conn)
                .map(|r| OptimizedShiftResultDomain {
                    id: r.id,
                    result: r.result,
                    creation_date: r.creation_date,
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_optimized_shift_result_by_id(
        &self,
        id: Uuid,
    ) -> Result<Option<OptimizedShiftResultDomain>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            optimized_shift_results::table
                .find(id)
                .first::<models::OptimizedShiftResult>(&mut conn)
                .map(Some)
                .or_else(|e| match e {
                    DieselError::NotFound => Ok(None),
                    _ => Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>),
                })
                .map(|opt| opt.map(|r| OptimizedShiftResultDomain {
                    id: r.id,
                    result: r.result,
                    creation_date: r.creation_date,
                }))
        })
        .await?
    }

    async fn get_latest_optimized_shift_result(
        &self,
    ) -> Result<Option<OptimizedShiftResultDomain>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            optimized_shift_results::table
                .order(optimized_shift_results::creation_date.desc())
                .first::<models::OptimizedShiftResult>(&mut conn)
                .map(Some)
                .or_else(|e| match e {
                    DieselError::NotFound => Ok(None),
                    _ => Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>),
                })
                .map(|opt| opt.map(|r| OptimizedShiftResultDomain {
                    id: r.id,
                    result: r.result,
                    creation_date: r.creation_date,
                }))
        })
        .await?
    }

    async fn list_optimized_shift_results(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<OptimizedShiftResultDomain>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let mut query = optimized_shift_results::table
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
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn count_optimized_shift_results(
        &self,
    ) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            optimized_shift_results::table
                .count()
                .first(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn delete_optimized_shift_result(
        &self,
        id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let count = diesel::delete(optimized_shift_results::table.find(id))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            if count == 0 {
                return Err(Box::new(AppError::NotFound) as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(())
        })
        .await?
    }
}
