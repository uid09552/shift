use async_trait::async_trait;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::repository::domain::{SavedView, SavedViewPreference, SavedViewRepository};
use crate::schema::{saved_view_preferences, saved_views};
use crate::telemetry;

type Row = (Uuid, String, String, Option<String>, String, String, serde_json::Value, bool, NaiveDateTime, NaiveDateTime);

#[allow(clippy::type_complexity)]
const COLUMNS: (
    saved_views::id,
    saved_views::tenant_id,
    saved_views::owner_subject,
    saved_views::owner_name,
    saved_views::page,
    saved_views::name,
    saved_views::filters,
    saved_views::shared,
    saved_views::created_at,
    saved_views::updated_at,
) = (
    saved_views::id,
    saved_views::tenant_id,
    saved_views::owner_subject,
    saved_views::owner_name,
    saved_views::page,
    saved_views::name,
    saved_views::filters,
    saved_views::shared,
    saved_views::created_at,
    saved_views::updated_at,
);

fn to_domain((id, tenant_id, owner_subject, owner_name, page, name, filters, shared, created_at, updated_at): Row) -> SavedView {
    SavedView { id, tenant_id, owner_subject, owner_name, page, name, filters, shared, created_at, updated_at }
}

fn db_error(e: diesel::result::Error) -> AppError {
    match e {
        diesel::result::Error::DatabaseError(diesel::result::DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
        diesel::result::Error::NotFound => AppError::NotFound,
        _ => AppError::DbError,
    }
}

#[derive(Clone)]
pub struct DieselSavedViewRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl SavedViewRepository for DieselSavedViewRepository {
    async fn list_saved_views(&self, tenant_id: &str, subject: &str, page: &str) -> Result<Vec<SavedView>, AppError> {
        let (tenant_id, subject, page) = (tenant_id.to_string(), subject.to_string(), page.to_string());
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            saved_views::table
                .filter(saved_views::tenant_id.eq(&tenant_id))
                .filter(saved_views::page.eq(&page))
                .filter(saved_views::owner_subject.eq(&subject).or(saved_views::shared.eq(true)))
                .order((saved_views::name.asc(), saved_views::created_at.asc()))
                .select(COLUMNS)
                .load::<Row>(&mut conn)
                .map(|rows| rows.into_iter().map(to_domain).collect())
                .map_err(db_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_saved_view(&self, tenant_id: &str, id: Uuid) -> Result<Option<SavedView>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            saved_views::table
                .filter(saved_views::tenant_id.eq(&tenant_id))
                .filter(saved_views::id.eq(id))
                .select(COLUMNS)
                .first::<Row>(&mut conn)
                .optional()
                .map(|r| r.map(to_domain))
                .map_err(db_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn create_saved_view(
        &self,
        tenant_id: &str,
        subject: &str,
        owner_name: Option<&str>,
        page: &str,
        name: &str,
        filters: serde_json::Value,
        shared: bool,
    ) -> Result<SavedView, AppError> {
        let (tenant_id, subject, page, name) = (tenant_id.to_string(), subject.to_string(), page.to_string(), name.to_string());
        let owner_name = owner_name.map(str::to_string);
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(saved_views::table)
                .values((
                    saved_views::tenant_id.eq(&tenant_id),
                    saved_views::owner_subject.eq(&subject),
                    saved_views::owner_name.eq(&owner_name),
                    saved_views::page.eq(&page),
                    saved_views::name.eq(&name),
                    saved_views::filters.eq(&filters),
                    saved_views::shared.eq(shared),
                ))
                .returning(COLUMNS)
                .get_result::<Row>(&mut conn)
                .map(to_domain)
                .map_err(db_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn update_saved_view(
        &self,
        tenant_id: &str,
        id: Uuid,
        name: Option<String>,
        filters: Option<serde_json::Value>,
        shared: Option<bool>,
    ) -> Result<SavedView, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<_, diesel::result::Error, _>(|conn| {
                let target = saved_views::table.filter(saved_views::tenant_id.eq(&tenant_id)).filter(saved_views::id.eq(id));
                if let Some(name) = &name {
                    diesel::update(target).set(saved_views::name.eq(name)).execute(conn)?;
                }
                if let Some(filters) = &filters {
                    diesel::update(target).set(saved_views::filters.eq(filters)).execute(conn)?;
                }
                if let Some(shared) = shared {
                    diesel::update(target).set(saved_views::shared.eq(shared)).execute(conn)?;
                }
                diesel::update(target)
                    .set(saved_views::updated_at.eq(chrono::Utc::now().naive_utc()))
                    .returning(COLUMNS)
                    .get_result::<Row>(conn)
            })
            .map(to_domain)
            .map_err(db_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn delete_saved_view(&self, tenant_id: &str, id: Uuid) -> Result<bool, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(saved_views::table.filter(saved_views::tenant_id.eq(&tenant_id)).filter(saved_views::id.eq(id)))
                .execute(&mut conn)
                .map(|n| n > 0)
                .map_err(db_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_view_preference(&self, tenant_id: &str, subject: &str, page: &str) -> Result<SavedViewPreference, AppError> {
        let (tenant_id, subject, page) = (tenant_id.to_string(), subject.to_string(), page.to_string());
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            saved_view_preferences::table
                .filter(saved_view_preferences::tenant_id.eq(&tenant_id))
                .filter(saved_view_preferences::user_subject.eq(&subject))
                .filter(saved_view_preferences::page.eq(&page))
                .select((saved_view_preferences::default_view_id, saved_view_preferences::last_view_id))
                .first::<(Option<Uuid>, Option<Uuid>)>(&mut conn)
                .optional()
                .map(|r| {
                    r.map(|(default_view_id, last_view_id)| SavedViewPreference { default_view_id, last_view_id })
                        .unwrap_or_default()
                })
                .map_err(db_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn set_view_preference(&self, tenant_id: &str, subject: &str, page: &str, pref: SavedViewPreference) -> Result<SavedViewPreference, AppError> {
        let (tenant_id, subject, page) = (tenant_id.to_string(), subject.to_string(), page.to_string());
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let now = chrono::Utc::now().naive_utc();
            diesel::insert_into(saved_view_preferences::table)
                .values((
                    saved_view_preferences::tenant_id.eq(&tenant_id),
                    saved_view_preferences::user_subject.eq(&subject),
                    saved_view_preferences::page.eq(&page),
                    saved_view_preferences::default_view_id.eq(pref.default_view_id),
                    saved_view_preferences::last_view_id.eq(pref.last_view_id),
                    saved_view_preferences::updated_at.eq(now),
                ))
                .on_conflict((saved_view_preferences::tenant_id, saved_view_preferences::user_subject, saved_view_preferences::page))
                .do_update()
                .set((
                    saved_view_preferences::default_view_id.eq(pref.default_view_id),
                    saved_view_preferences::last_view_id.eq(pref.last_view_id),
                    saved_view_preferences::updated_at.eq(now),
                ))
                .execute(&mut conn)
                .map(|_| pref)
                .map_err(db_error)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}
