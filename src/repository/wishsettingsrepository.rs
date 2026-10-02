use std::sync::Arc;
use async_trait::async_trait;
use diesel::prelude::*;

use crate::telemetry;
use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewWishSettings, WishScheduleChangeset, WishSettings};
use crate::schema::wish_settings;
use super::domain::{
    ScheduleUnit, UpdateWishSettings, WishMode, WishScheduleDomain, WishSettingsDomain, WishSettingsRepository,
};

#[derive(Clone)]
pub struct DieselWishSettingsRepository {
    pub pool: Arc<DbPool>,
}

fn to_domain(s: WishSettings) -> WishSettingsDomain {
    WishSettingsDomain {
        mode: WishMode::from_db(&s.mode),
        window_start: s.window_start,
        window_end: s.window_end,
        schedule: WishScheduleDomain {
            enabled: s.schedule_enabled,
            unit: ScheduleUnit::from_db(&s.schedule_unit),
            interval: s.schedule_interval,
            weekday: s.schedule_weekday,
            day_of_month: s.schedule_day_of_month,
            time: s.schedule_time,
            open_days: s.schedule_open_days,
            start_date: s.schedule_start_date,
            applied_open: s.schedule_applied_open,
        },
        updated_at: s.updated_at,
    }
}

#[async_trait]
impl WishSettingsRepository for DieselWishSettingsRepository {
    async fn get_or_create_wish_settings(&self, tenant_id: &str) -> Result<WishSettingsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let existing = wish_settings::table
                .filter(wish_settings::tenant_id.eq(&tenant_id))
                .first::<WishSettings>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;
            if let Some(row) = existing {
                return Ok(to_domain(row));
            }

            let defaults = NewWishSettings::defaults(&tenant_id);
            let inserted: WishSettings = diesel::insert_into(wish_settings::table)
                .values(&defaults)
                .on_conflict(wish_settings::tenant_id)
                .do_update()
                .set(&defaults)
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(to_domain(inserted))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_wish_settings(&self, tenant_id: &str, settings: UpdateWishSettings) -> Result<WishSettingsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_settings = NewWishSettings {
                tenant_id: tenant_id.clone(),
                mode: settings.mode.as_str().to_string(),
                window_start: settings.window_start,
                window_end: settings.window_end,
            };
            let updated: WishSettings = diesel::insert_into(wish_settings::table)
                .values(&new_settings)
                .on_conflict(wish_settings::tenant_id)
                .do_update()
                .set((&new_settings, wish_settings::updated_at.eq(diesel::dsl::now)))
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(to_domain(updated))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_wish_schedule(&self, tenant_id: &str, schedule: WishScheduleDomain) -> Result<WishSettingsDomain, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let changes = WishScheduleChangeset {
                schedule_enabled: schedule.enabled,
                schedule_unit: schedule.unit.as_str().to_string(),
                schedule_interval: schedule.interval,
                schedule_weekday: schedule.weekday,
                schedule_day_of_month: schedule.day_of_month,
                schedule_time: schedule.time,
                schedule_open_days: schedule.open_days,
                schedule_start_date: schedule.start_date,
                schedule_applied_open: None,
            };
            let updated: WishSettings = diesel::update(wish_settings::table.filter(wish_settings::tenant_id.eq(&tenant_id)))
                .set((&changes, wish_settings::updated_at.eq(diesel::dsl::now)))
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(to_domain(updated))
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_scheduled_wish_settings(&self) -> Result<Vec<(String, WishSettingsDomain)>, AppError> {
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let rows = wish_settings::table
                .filter(wish_settings::schedule_enabled.eq(true))
                .load::<WishSettings>(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(rows.into_iter().map(|row| (row.tenant_id.clone(), to_domain(row))).collect())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn apply_scheduled_wish_state(&self, tenant_id: &str, open: bool) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mode = if open { WishMode::Enabled } else { WishMode::Disabled };
            let changed = diesel::update(
                wish_settings::table
                    .filter(wish_settings::tenant_id.eq(&tenant_id))
                    .filter(wish_settings::schedule_enabled.eq(true))
                    .filter(
                        wish_settings::schedule_applied_open
                            .is_null()
                            .or(wish_settings::schedule_applied_open.ne(Some(open))),
                    ),
            )
            .set((
                wish_settings::mode.eq(mode.as_str()),
                wish_settings::schedule_applied_open.eq(Some(open)),
                wish_settings::updated_at.eq(diesel::dsl::now),
            ))
            .execute(&mut conn)
            .map_err(|_| AppError::DbError)?;
            Ok(changed > 0)
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
