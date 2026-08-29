use std::sync::Arc;
use async_trait::async_trait;
use diesel::prelude::*;

use crate::telemetry;
use crate::database::DbPool;
use crate::errors::AppError;
use crate::models::{NewWishSettings, WishSettings};
use crate::schema::wish_settings;
use super::domain::{UpdateWishSettings, WishMode, WishSettingsDomain, WishSettingsRepository};

#[derive(Clone)]
pub struct DieselWishSettingsRepository {
    pub pool: Arc<DbPool>,
}

fn to_domain(s: WishSettings) -> WishSettingsDomain {
    WishSettingsDomain {
        mode: WishMode::from_db(&s.mode),
        window_start: s.window_start,
        window_end: s.window_end,
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
}
