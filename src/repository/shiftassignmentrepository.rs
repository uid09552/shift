use async_trait::async_trait;
use chrono::NaiveDate;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;
use crate::telemetry;
use crate::errors::AppError;
use diesel::result::{Error as DieselError, DatabaseErrorKind};

use crate::database::DbPool;
use crate::repository::domain::{
    EmployeeShiftAssignment, EmployeeShiftAssignmentRepository,
};
use crate::models::NewEmployeeShiftAssignment;
use crate::models as models;
use crate::schema::employee_shift_assignments;

#[derive(Clone)]
pub struct DieselEmployeeShiftAssignmentRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl EmployeeShiftAssignmentRepository for DieselEmployeeShiftAssignmentRepository {
    async fn create_assignment(
        &self,
        tenant_id: &str,
        assignment: EmployeeShiftAssignment,
    ) -> Result<EmployeeShiftAssignment, AppError> {
        let pool = Arc::clone(&self.pool);
        let new_assignment = NewEmployeeShiftAssignment {
            employee_id: assignment.employee_id,
            shift_id: assignment.shift_id,
            date: assignment.date,
            tenant_id: tenant_id.to_string(),
        };
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let created = diesel::insert_into(employee_shift_assignments::table)
                .values(&new_assignment)
                .get_result::<models::EmployeeShiftAssignment>(&mut conn)
                .map(|a| EmployeeShiftAssignment {
                    id: a.id,
                    employee_id: a.employee_id,
                    shift_id: a.shift_id,
                    date: a.date,
                })
                .map_err(|e| match e {
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
                    _ => AppError::DbError,
                })?;
            Ok(created)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_assignments_for_employee(
        &self,
        tenant_id: &str,
        employee_id: Uuid,
    ) -> Result<Vec<EmployeeShiftAssignment>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            employee_shift_assignments::table
                .filter(employee_shift_assignments::employee_id.eq(employee_id))
                .filter(employee_shift_assignments::tenant_id.eq(&tenant_id))
                .order(employee_shift_assignments::date.asc())
                .load::<models::EmployeeShiftAssignment>(&mut conn)
                .map(|assignments: Vec<models::EmployeeShiftAssignment>| {
                    assignments
                        .into_iter()
                        .map(|a| EmployeeShiftAssignment {
                            id: a.id,
                            employee_id: a.employee_id,
                            shift_id: a.shift_id,
                            date: a.date,
                        })
                        .collect()
                })
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_assignments_for_employee_in_range(
        &self,
        tenant_id: &str,
        employee_id: Uuid,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<EmployeeShiftAssignment>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            employee_shift_assignments::table
                .filter(employee_shift_assignments::employee_id.eq(employee_id))
                .filter(employee_shift_assignments::tenant_id.eq(&tenant_id))
                .filter(employee_shift_assignments::date.ge(from_date))
                .filter(employee_shift_assignments::date.le(to_date))
                .order(employee_shift_assignments::date.asc())
                .load::<models::EmployeeShiftAssignment>(&mut conn)
                .map(|assignments: Vec<models::EmployeeShiftAssignment>| {
                    assignments
                        .into_iter()
                        .map(|a| EmployeeShiftAssignment {
                            id: a.id,
                            employee_id: a.employee_id,
                            shift_id: a.shift_id,
                            date: a.date,
                        })
                        .collect()
                })
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_assignments_in_range(
        &self,
        tenant_id: &str,
        employee_ids: Option<Vec<Uuid>>,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<EmployeeShiftAssignment>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = employee_shift_assignments::table
                .filter(employee_shift_assignments::tenant_id.eq(&tenant_id))
                .filter(employee_shift_assignments::date.ge(from_date))
                .filter(employee_shift_assignments::date.le(to_date))
                .into_boxed();
            if let Some(ids) = employee_ids {
                query = query.filter(employee_shift_assignments::employee_id.eq_any(ids));
            }
            query
                .order((employee_shift_assignments::employee_id.asc(), employee_shift_assignments::date.asc()))
                .load::<models::EmployeeShiftAssignment>(&mut conn)
                .map(|rows| rows.into_iter().map(to_domain).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn replace_assignments(
        &self,
        tenant_id: &str,
        delete_ids: Vec<Uuid>,
        inserts: Vec<EmployeeShiftAssignment>,
    ) -> Result<usize, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            conn.transaction::<usize, DieselError, _>(|conn| {
                if !delete_ids.is_empty() {
                    diesel::delete(
                        employee_shift_assignments::table
                            .filter(employee_shift_assignments::tenant_id.eq(&tenant_id))
                            .filter(employee_shift_assignments::id.eq_any(&delete_ids)),
                    )
                    .execute(conn)?;
                }
                let rows: Vec<NewEmployeeShiftAssignment> = inserts
                    .iter()
                    .map(|a| NewEmployeeShiftAssignment {
                        employee_id: a.employee_id,
                        shift_id: a.shift_id,
                        date: a.date,
                        tenant_id: tenant_id.clone(),
                    })
                    .collect();
                diesel::insert_into(employee_shift_assignments::table)
                    .values(&rows)
                    .execute(conn)
            })
            .map_err(|e| match e {
                DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
                _ => AppError::DbError,
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_assignments_in_range(
        &self,
        tenant_id: &str,
        employee_ids: Vec<Uuid>,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<usize, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                employee_shift_assignments::table
                    .filter(employee_shift_assignments::tenant_id.eq(&tenant_id))
                    .filter(employee_shift_assignments::employee_id.eq_any(&employee_ids))
                    .filter(employee_shift_assignments::date.ge(from_date))
                    .filter(employee_shift_assignments::date.le(to_date)),
            )
            .execute(&mut conn)
            .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_assignment(
        &self,
        tenant_id: &str,
        id: Uuid,
    ) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let count = diesel::delete(
                employee_shift_assignments::table
                    .filter(employee_shift_assignments::id.eq(id))
                    .filter(employee_shift_assignments::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            if count == 0 {
                return Err(AppError::NotFound);
            }
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

fn to_domain(a: models::EmployeeShiftAssignment) -> EmployeeShiftAssignment {
    EmployeeShiftAssignment {
        id: a.id,
        employee_id: a.employee_id,
        shift_id: a.shift_id,
        date: a.date,
    }
}
