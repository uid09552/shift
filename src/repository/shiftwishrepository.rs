use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;
use crate::telemetry;
use crate::errors::AppError;
use diesel::result::{Error as DieselError, DatabaseErrorKind};

use crate::database::DbPool;
use crate::repository::domain::{ShiftWish, ShiftWishRepository};
use crate::models::NewShiftWish;
use crate::models as models;
use crate::schema::shift_wishes;

fn to_domain(w: models::ShiftWish) -> ShiftWish {
    ShiftWish {
        id: w.id,
        employee_id: w.employee_id,
        shift_id: w.shift_id,
        wish_date: w.wish_date,
    }
}

#[derive(Clone)]
pub struct DieselShiftWishRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl ShiftWishRepository for DieselShiftWishRepository {
    async fn create_shift_wish(&self, tenant_id: &str, wish: ShiftWish) -> Result<ShiftWish, AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_wish = NewShiftWish {
            employee_id: wish.employee_id,
            shift_id: wish.shift_id,
            wish_date: wish.wish_date,
            tenant_id: tenant_id.to_string(),
        };
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(shift_wishes::table)
                .values(&new_wish)
                .get_result::<models::ShiftWish>(&mut conn)
                .map(to_domain)
                .map_err(|e| match e {
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
                    _ => AppError::DbError,
                })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_shift_wish(&self, tenant_id: &str, id: Uuid) -> Result<Option<ShiftWish>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            shift_wishes::table
                .filter(shift_wishes::id.eq(id))
                .filter(shift_wishes::tenant_id.eq(&tenant_id))
                .first::<models::ShiftWish>(&mut conn)
                .optional()
                .map(|w| w.map(to_domain))
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_shift_wishes(&self, tenant_id: &str) -> Result<Vec<ShiftWish>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            shift_wishes::table
                .filter(shift_wishes::tenant_id.eq(&tenant_id))
                .load::<models::ShiftWish>(&mut conn)
                .map(|wishes| wishes.into_iter().map(to_domain).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_shift_wishes_for_employee(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<ShiftWish>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            shift_wishes::table
                .filter(shift_wishes::employee_id.eq(employee_id))
                .filter(shift_wishes::tenant_id.eq(&tenant_id))
                .load::<models::ShiftWish>(&mut conn)
                .map(|wishes| wishes.into_iter().map(to_domain).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_shift_wish(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                shift_wishes::table
                    .filter(shift_wishes::id.eq(id))
                    .filter(shift_wishes::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
