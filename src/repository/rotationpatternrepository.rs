use async_trait::async_trait;
use diesel::prelude::*;
use diesel::result::{DatabaseErrorKind, Error as DieselError};
use std::sync::Arc;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewRotationPattern, RotationPattern};
use crate::repository::domain::{RotationPatternDomain, RotationPatternRepository};
use crate::schema::rotation_patterns;
use crate::telemetry;

#[derive(Clone)]
pub struct DieselRotationPatternRepository {
    pub pool: Arc<DbPool>,
}

/// Slots are stored as a JSON array of shift id strings and nulls.
fn slots_to_json(slots: &[Option<Uuid>]) -> serde_json::Value {
    serde_json::Value::Array(
        slots
            .iter()
            .map(|s| s.map_or(serde_json::Value::Null, |id| serde_json::Value::String(id.to_string())))
            .collect(),
    )
}

fn to_domain(row: RotationPattern) -> RotationPatternDomain {
    let slots = row
        .slots
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|v| v.as_str().and_then(|s| s.parse::<Uuid>().ok()))
                .collect()
        })
        .unwrap_or_default();
    RotationPatternDomain {
        id: row.id,
        name: row.name,
        slots,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn map_write_error(e: DieselError) -> AppError {
    match e {
        DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
        DieselError::NotFound => AppError::NotFound,
        _ => AppError::DbError,
    }
}

#[async_trait]
impl RotationPatternRepository for DieselRotationPatternRepository {
    async fn list_patterns(&self, tenant_id: &str) -> Result<Vec<RotationPatternDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            rotation_patterns::table
                .filter(rotation_patterns::tenant_id.eq(&tenant_id))
                .order(rotation_patterns::name.asc())
                .load::<RotationPattern>(&mut conn)
                .map(|rows| rows.into_iter().map(to_domain).collect())
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_pattern(&self, tenant_id: &str, id: Uuid) -> Result<Option<RotationPatternDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            rotation_patterns::table
                .filter(rotation_patterns::tenant_id.eq(&tenant_id))
                .filter(rotation_patterns::id.eq(id))
                .first::<RotationPattern>(&mut conn)
                .optional()
                .map(|row| row.map(to_domain))
                .map_err(|_| AppError::DbError)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn create_pattern(&self, tenant_id: &str, name: String, slots: Vec<Option<Uuid>>) -> Result<RotationPatternDomain, AppError> {
        let row = NewRotationPattern { tenant_id: tenant_id.to_string(), name, slots: slots_to_json(&slots) };
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(rotation_patterns::table)
                .values(&row)
                .get_result::<RotationPattern>(&mut conn)
                .map(to_domain)
                .map_err(map_write_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn update_pattern(&self, tenant_id: &str, id: Uuid, name: String, slots: Vec<Option<Uuid>>) -> Result<RotationPatternDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let json = slots_to_json(&slots);
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                rotation_patterns::table
                    .filter(rotation_patterns::tenant_id.eq(&tenant_id))
                    .filter(rotation_patterns::id.eq(id)),
            )
            .set((
                rotation_patterns::name.eq(name),
                rotation_patterns::slots.eq(json),
                rotation_patterns::updated_at.eq(diesel::dsl::now),
            ))
            .get_result::<RotationPattern>(&mut conn)
            .map(to_domain)
            .map_err(map_write_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn delete_pattern(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let count = diesel::delete(
                rotation_patterns::table
                    .filter(rotation_patterns::tenant_id.eq(&tenant_id))
                    .filter(rotation_patterns::id.eq(id)),
            )
            .execute(&mut conn)
            .map_err(|_| AppError::DbError)?;
            if count == 0 {
                return Err(AppError::NotFound);
            }
            Ok(())
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}
