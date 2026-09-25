use std::sync::Arc;
use async_trait::async_trait;
use diesel::prelude::*;
use uuid::Uuid;

use crate::telemetry;
use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewPersonalLimits, PersonalLimits};
use crate::schema::employee_personal_limits;
use super::domain::{PersonalLimitsDomain, PersonalLimitsRepository, UpdatePersonalLimits};

#[derive(Clone)]
pub struct DieselPersonalLimitsRepository {
    pub pool: Arc<DbPool>,
}

fn to_domain(p: PersonalLimits) -> PersonalLimitsDomain {
    PersonalLimitsDomain {
        employee_id: p.employee_id,
        max_nights_per_month: p.max_nights_per_month,
        max_weekends_per_month: p.max_weekends_per_month,
        no_night_shifts: p.no_night_shifts,
        preferred_days_off: p.preferred_days_off,
        updated_at: Some(p.updated_at),
    }
}

#[async_trait]
impl PersonalLimitsRepository for DieselPersonalLimitsRepository {
    async fn list_personal_limits(&self, tenant_id: &str) -> Result<Vec<PersonalLimitsDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let rows = employee_personal_limits::table
                .filter(employee_personal_limits::tenant_id.eq(&tenant_id))
                .load::<PersonalLimits>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(rows.into_iter().map(to_domain).collect())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_personal_limits(&self, tenant_id: &str, employee_id: Uuid) -> Result<PersonalLimitsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let row = employee_personal_limits::table
                .filter(employee_personal_limits::tenant_id.eq(&tenant_id))
                .filter(employee_personal_limits::employee_id.eq(employee_id))
                .first::<PersonalLimits>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;
            Ok(row.map(to_domain).unwrap_or_else(|| PersonalLimitsDomain::none(employee_id)))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_personal_limits(
        &self,
        tenant_id: &str,
        employee_id: Uuid,
        limits: UpdatePersonalLimits,
    ) -> Result<PersonalLimitsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let row = NewPersonalLimits {
                employee_id,
                tenant_id,
                max_nights_per_month: limits.max_nights_per_month,
                max_weekends_per_month: limits.max_weekends_per_month,
                no_night_shifts: limits.no_night_shifts,
                preferred_days_off: limits.preferred_days_off,
            };
            let saved: PersonalLimits = diesel::insert_into(employee_personal_limits::table)
                .values(&row)
                .on_conflict(employee_personal_limits::employee_id)
                .do_update()
                .set((&row, employee_personal_limits::updated_at.eq(diesel::dsl::now)))
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(to_domain(saved))
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
