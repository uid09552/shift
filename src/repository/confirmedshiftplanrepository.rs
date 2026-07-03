use async_trait::async_trait;
use chrono::NaiveDate;
use chrono::Utc;
use diesel::prelude::*;
use std::sync::Arc;
use tokio::task;
use uuid::Uuid;
use crate::errors::AppError;
use diesel::result::Error as DieselError;
use diesel::pg::upsert::excluded;

use crate::database::DbPool;
use crate::repository::domain::{
    ConfirmedShiftPlan, ConfirmedShiftPlanRepository,
};
use crate::models::NewConfirmedShiftPlan;
use crate::models::UpdateConfirmedShiftPlan;
use crate::models as models;
use crate::schema::confirmed_shift_plans;

#[derive(Clone)]
pub struct DieselConfirmedShiftPlanRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl ConfirmedShiftPlanRepository for DieselConfirmedShiftPlanRepository {
    async fn create_confirmed_shift_plan(
        &self,
        plan: ConfirmedShiftPlan,
    ) -> Result<ConfirmedShiftPlan, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        let new_plan = NewConfirmedShiftPlan {
            employee_id: plan.employee_id,
            shift_id: plan.shift_id,
            workstation_id: plan.workstation_id,
            date: plan.date,
            is_present: plan.is_present,
            absence_type: plan.absence_type.clone(),
            creation_type: plan.creation_type.clone(),
        };
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            // Upsert: if a plan already exists for (employee_id, date), update it
            // so that marking a day as leave never conflicts with an existing entry.
            let created = diesel::insert_into(confirmed_shift_plans::table)
                .values(&new_plan)
                .on_conflict((confirmed_shift_plans::employee_id, confirmed_shift_plans::date))
                .do_update()
                .set((
                    confirmed_shift_plans::shift_id.eq(excluded(confirmed_shift_plans::shift_id)),
                    confirmed_shift_plans::workstation_id.eq(excluded(confirmed_shift_plans::workstation_id)),
                    confirmed_shift_plans::is_present.eq(excluded(confirmed_shift_plans::is_present)),
                    confirmed_shift_plans::absence_type.eq(excluded(confirmed_shift_plans::absence_type)),
                    confirmed_shift_plans::creation_type.eq(excluded(confirmed_shift_plans::creation_type)),
                    confirmed_shift_plans::updated_at.eq(diesel::dsl::now),
                ))
                .get_result::<models::ConfirmedShiftPlan>(&mut conn)
                .map(|p| ConfirmedShiftPlan {
                    id: p.id,
                    employee_id: p.employee_id,
                    shift_id: p.shift_id,
                    workstation_id: p.workstation_id,
                    date: p.date,
                    is_present: p.is_present,
                    absence_type: p.absence_type,
                    creation_type: p.creation_type,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(created)
        })
        .await?
    }

    async fn get_confirmed_shift_plans_for_employee(
        &self,
        employee_id: Uuid,
    ) -> Result<Vec<ConfirmedShiftPlan>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            confirmed_shift_plans::table
                .filter(confirmed_shift_plans::employee_id.eq(employee_id))
                .order(confirmed_shift_plans::date.asc())
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map(|plans: Vec<models::ConfirmedShiftPlan>| {
                    plans
                        .into_iter()
                        .map(|p| ConfirmedShiftPlan {
                            id: p.id,
                            employee_id: p.employee_id,
                            shift_id: p.shift_id,
                            workstation_id: p.workstation_id,
                            date: p.date,
                            is_present: p.is_present,
                            absence_type: p.absence_type,
                            creation_type: p.creation_type,
                            created_at: p.created_at,
                            updated_at: p.updated_at,
                        })
                        .collect()
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_confirmed_shift_plans_for_employee_in_range(
        &self,
        employee_id: Uuid,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<ConfirmedShiftPlan>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            confirmed_shift_plans::table
                .filter(confirmed_shift_plans::employee_id.eq(employee_id))
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .order(confirmed_shift_plans::date.asc())
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map(|plans: Vec<models::ConfirmedShiftPlan>| {
                    plans
                        .into_iter()
                        .map(|p| ConfirmedShiftPlan {
                            id: p.id,
                            employee_id: p.employee_id,
                            shift_id: p.shift_id,
                            workstation_id: p.workstation_id,
                            date: p.date,
                            is_present: p.is_present,
                            absence_type: p.absence_type,
                            creation_type: p.creation_type,
                            created_at: p.created_at,
                            updated_at: p.updated_at,
                        })
                        .collect()
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_confirmed_shift_plan_by_id(
        &self,
        id: Uuid,
    ) -> Result<Option<ConfirmedShiftPlan>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            confirmed_shift_plans::table
                .find(id)
                .first::<models::ConfirmedShiftPlan>(&mut conn)
                .map(Some)
                .or_else(|e| match e {
                    DieselError::NotFound => Ok(None),
                    _ => Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>),
                })
                .map(|opt| opt.map(|p| ConfirmedShiftPlan {
                    id: p.id,
                    employee_id: p.employee_id,
                    shift_id: p.shift_id,
                    workstation_id: p.workstation_id,
                    date: p.date,
                    is_present: p.is_present,
                    absence_type: p.absence_type,
                    creation_type: p.creation_type,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                }))
        })
        .await?
    }

    async fn update_confirmed_shift_plan(
        &self,
        id: Uuid,
        shift_id: Option<Option<Uuid>>,
        workstation_id: Option<Option<Uuid>>,
        is_present: Option<bool>,
        absence_type: Option<String>,
        creation_type: Option<String>,
    ) -> Result<ConfirmedShiftPlan, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let update = UpdateConfirmedShiftPlan {
                shift_id,
                workstation_id,
                is_present,
                absence_type,
                creation_type,
                updated_at: Utc::now().naive_utc(),
            };
            let updated = diesel::update(confirmed_shift_plans::table.find(id))
                .set(&update)
                .get_result::<models::ConfirmedShiftPlan>(&mut conn)
                .map(|p| ConfirmedShiftPlan {
                    id: p.id,
                    employee_id: p.employee_id,
                    shift_id: p.shift_id,
                    workstation_id: p.workstation_id,
                    date: p.date,
                    is_present: p.is_present,
                    absence_type: p.absence_type,
                    creation_type: p.creation_type,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(updated)
        })
        .await?
    }

    async fn delete_confirmed_shift_plan(
        &self,
        id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let count = diesel::delete(confirmed_shift_plans::table.find(id))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            if count == 0 {
                return Err(Box::new(AppError::NotFound) as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(())
        })
        .await?
    }

    async fn delete_confirmed_shift_plans_for_employee_date_type(
        &self,
        employee_id: Uuid,
        date: NaiveDate,
        absence_type: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        let absence_type = absence_type.to_owned();
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::delete(
                confirmed_shift_plans::table
                    .filter(confirmed_shift_plans::employee_id.eq(employee_id))
                    .filter(confirmed_shift_plans::date.eq(date))
                    .filter(confirmed_shift_plans::absence_type.eq(Some(absence_type))),
            )
            .execute(&mut conn)
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }

    async fn list_confirmed_shift_plans(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<ConfirmedShiftPlan>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let mut query = confirmed_shift_plans::table
                .order(confirmed_shift_plans::date.asc())
                .into_boxed();
            if let Some(l) = limit {
                query = query.limit(l);
            }
            if let Some(o) = offset {
                query = query.offset(o);
            }
            query
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map(|plans: Vec<models::ConfirmedShiftPlan>| {
                    plans
                        .into_iter()
                        .map(|p| ConfirmedShiftPlan {
                            id: p.id,
                            employee_id: p.employee_id,
                            shift_id: p.shift_id,
                            workstation_id: p.workstation_id,
                            date: p.date,
                            is_present: p.is_present,
                            absence_type: p.absence_type,
                            creation_type: p.creation_type,
                            created_at: p.created_at,
                            updated_at: p.updated_at,
                        })
                        .collect()
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn count_confirmed_shift_plans(
        &self,
    ) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            confirmed_shift_plans::table
                .count()
                .first(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_confirmed_shift_plans_for_date_range(
        &self,
        from_date: NaiveDate,
        to_date: NaiveDate,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<ConfirmedShiftPlan>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let mut query = confirmed_shift_plans::table
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .order(confirmed_shift_plans::date.asc())
                .into_boxed();
            if let Some(l) = limit {
                query = query.limit(l);
            }
            if let Some(o) = offset {
                query = query.offset(o);
            }
            query
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map(|plans: Vec<models::ConfirmedShiftPlan>| {
                    plans
                        .into_iter()
                        .map(|p| ConfirmedShiftPlan {
                            id: p.id,
                            employee_id: p.employee_id,
                            shift_id: p.shift_id,
                            workstation_id: p.workstation_id,
                            date: p.date,
                            is_present: p.is_present,
                            absence_type: p.absence_type,
                            creation_type: p.creation_type,
                            created_at: p.created_at,
                            updated_at: p.updated_at,
                        })
                        .collect()
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn count_confirmed_shift_plans_for_date_range(
        &self,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            confirmed_shift_plans::table
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .count()
                .first(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }
}
