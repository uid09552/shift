use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{AvailabilityRule, NewAvailabilityRule, NewPairingRule, NewSkillMixRule, PairingRule, SkillMixRule};
use crate::repository::domain::{AvailabilityRuleRepository, StaffingRuleRepository};
use crate::schema::{availability_rules, pairing_rules, skill_mix_rules};
use crate::telemetry;

#[derive(Clone)]
pub struct DieselStaffingRuleRepository {
    pub pool: Arc<DbPool>,
}

/// Runs `f` on a pooled connection off the async runtime.
async fn with_conn<T: Send + 'static>(
    pool: &Arc<DbPool>,
    f: impl FnOnce(&mut PgConnection) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    let pool = Arc::clone(pool);
    telemetry::db_blocking(move || {
        let mut conn = pool.get().map_err(|_| AppError::DbError)?;
        f(&mut conn)
    })
    .await
    .map_err(|_| AppError::Internal)?
}

#[async_trait]
impl StaffingRuleRepository for DieselStaffingRuleRepository {
    async fn list_skill_mix_rules(&self, tenant_id: &str) -> Result<Vec<SkillMixRule>, AppError> {
        let tenant_id = tenant_id.to_string();
        with_conn(&self.pool, move |conn| {
            Ok(skill_mix_rules::table
                .filter(skill_mix_rules::tenant_id.eq(&tenant_id))
                .order(skill_mix_rules::created_at.asc())
                .load::<SkillMixRule>(conn)?)
        })
        .await
    }

    async fn create_skill_mix_rule(&self, rule: NewSkillMixRule) -> Result<SkillMixRule, AppError> {
        with_conn(&self.pool, move |conn| {
            Ok(diesel::insert_into(skill_mix_rules::table).values(&rule).get_result::<SkillMixRule>(conn)?)
        })
        .await
    }

    async fn delete_skill_mix_rule(&self, tenant_id: &str, id: Uuid) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        with_conn(&self.pool, move |conn| {
            Ok(diesel::delete(
                skill_mix_rules::table
                    .filter(skill_mix_rules::id.eq(id))
                    .filter(skill_mix_rules::tenant_id.eq(&tenant_id)),
            )
            .execute(conn)?
                > 0)
        })
        .await
    }

    async fn list_pairing_rules(&self, tenant_id: &str) -> Result<Vec<PairingRule>, AppError> {
        let tenant_id = tenant_id.to_string();
        with_conn(&self.pool, move |conn| {
            Ok(pairing_rules::table
                .filter(pairing_rules::tenant_id.eq(&tenant_id))
                .order(pairing_rules::created_at.asc())
                .load::<PairingRule>(conn)?)
        })
        .await
    }

    async fn create_pairing_rule(&self, rule: NewPairingRule) -> Result<PairingRule, AppError> {
        with_conn(&self.pool, move |conn| {
            Ok(diesel::insert_into(pairing_rules::table).values(&rule).get_result::<PairingRule>(conn)?)
        })
        .await
    }

    async fn delete_pairing_rule(&self, tenant_id: &str, id: Uuid) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        with_conn(&self.pool, move |conn| {
            Ok(diesel::delete(
                pairing_rules::table
                    .filter(pairing_rules::id.eq(id))
                    .filter(pairing_rules::tenant_id.eq(&tenant_id)),
            )
            .execute(conn)?
                > 0)
        })
        .await
    }
}

#[async_trait]
impl AvailabilityRuleRepository for DieselStaffingRuleRepository {
    async fn list_availability_rules(&self, tenant_id: &str, employee_id: Option<Uuid>) -> Result<Vec<AvailabilityRule>, AppError> {
        let tenant_id = tenant_id.to_string();
        with_conn(&self.pool, move |conn| {
            let mut query = availability_rules::table
                .filter(availability_rules::tenant_id.eq(&tenant_id))
                .order(availability_rules::created_at.asc())
                .into_boxed();
            if let Some(employee_id) = employee_id {
                query = query.filter(availability_rules::employee_id.eq(employee_id));
            }
            Ok(query.load::<AvailabilityRule>(conn)?)
        })
        .await
    }

    async fn create_availability_rule(&self, rule: NewAvailabilityRule) -> Result<AvailabilityRule, AppError> {
        with_conn(&self.pool, move |conn| {
            Ok(diesel::insert_into(availability_rules::table).values(&rule).get_result::<AvailabilityRule>(conn)?)
        })
        .await
    }

    async fn delete_availability_rule(&self, tenant_id: &str, employee_id: Uuid, id: Uuid) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        with_conn(&self.pool, move |conn| {
            Ok(diesel::delete(
                availability_rules::table
                    .filter(availability_rules::id.eq(id))
                    .filter(availability_rules::employee_id.eq(employee_id))
                    .filter(availability_rules::tenant_id.eq(&tenant_id)),
            )
            .execute(conn)?
                > 0)
        })
        .await
    }
}
