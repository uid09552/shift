use async_trait::async_trait;
use chrono::NaiveDate;
use diesel::prelude::*;
use std::sync::Arc;
use tokio::task;
use uuid::Uuid;
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
        assignment: EmployeeShiftAssignment,
    ) -> Result<EmployeeShiftAssignment, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        let new_assignment = NewEmployeeShiftAssignment {
            employee_id: assignment.employee_id,
            shift_id: assignment.shift_id,
            date: assignment.date,
        };
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
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
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => {
                        Box::new(AppError::Duplicate) as Box<dyn std::error::Error + Send + Sync>
                    }
                    _ => Box::new(e) as Box<dyn std::error::Error + Send + Sync>,
                })?;
            Ok(created)
        })
        .await?
    }

    async fn get_assignments_for_employee(
        &self,
        employee_id: Uuid,
    ) -> Result<Vec<EmployeeShiftAssignment>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            employee_shift_assignments::table
                .filter(employee_shift_assignments::employee_id.eq(employee_id))
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
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_assignments_for_employee_in_range(
        &self,
        employee_id: Uuid,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<EmployeeShiftAssignment>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            employee_shift_assignments::table
                .filter(employee_shift_assignments::employee_id.eq(employee_id))
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
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn delete_assignment(
        &self,
        id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let count = diesel::delete(employee_shift_assignments::table.find(id))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            if count == 0 {
                return Err(Box::new(AppError::NotFound) as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(())
        })
        .await?
    }
}
