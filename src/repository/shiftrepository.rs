use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use crate::repository::domain::{Shift, ShiftRepository};
use crate::models::{self, NewShift};
use crate::schema::shifts;
use crate::database::DbPool;
use uuid::Uuid;
use tokio::task;
use crate::errors::AppError;

#[derive(Clone)]
pub struct DieselShiftRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl ShiftRepository for DieselShiftRepository {
    async fn create_shift(&self, name: &str) -> Result<Shift, AppError> {
        let name = name.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_shift = NewShift { name: &name };
            diesel::insert_into(shifts::table)
                .values(&new_shift)
                .get_result::<models::Shift>(&mut conn)
                .map(|s| Shift { id: s.id, name: s.name })
                .map_err(|e| match e {
                    diesel::result::Error::DatabaseError(diesel::result::DatabaseErrorKind::UniqueViolation, _) => {
                        AppError::Duplicate
                    }
                    diesel::result::Error::NotFound => AppError::NotFound,
                    _ => AppError::DbError,
                })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_shift(&self, id: Uuid) -> Result<Option<Shift>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            shifts::table
                .find(id)
                .first::<models::Shift>(&mut conn)
                .optional()
                .map(|s: Option<models::Shift>| s.map(|s| Shift { id: s.id, name: s.name }))
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn list_shifts(&self) -> Result<Vec<Shift>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            shifts::table
                .load::<models::Shift>(&mut conn)
                .map(|shifts: Vec<models::Shift>| {
                    shifts.into_iter().map(|s| Shift { id: s.id, name: s.name }).collect()
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }
}
