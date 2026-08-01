use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;
use crate::telemetry;
use crate::errors::AppError;
use diesel::result::{Error as DieselError, DatabaseErrorKind};

use crate::database::DbPool;
use crate::repository::domain::{
    CapabilityRepository, Capability, Employee, EmployeeRepository, Shift,
    Unavailability, UnavailabilityRepository, Workstation, WorkstationUnavailability,
};
use crate::models::{
    NewCapability, NewEmployee, NewEmployeeAvailableShift, NewEmployeeCapability, NewUnavailability, NewWorkstation,
    NewWorkstationRequiredCapability, NewWorkstationUnavailability,
};
use crate::models as models;
use crate::schema::{
    capabilities,
    employee_available_shifts,
    employee_capabilities,
    employees,
    shifts,
    unavailabilities,
    workstations,
    workstation_required_capabilities,
    workstation_unavailabilities,
};

#[derive(Clone)]
pub struct DieselEmployeeRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl EmployeeRepository for DieselEmployeeRepository {
    async fn create_employee(
        &self,
        tenant_id: &str,
        name: &str,
        email: &str,
        monthly_working_hours: f64,
    ) -> Result<Employee, AppError> {
        let tenant_id = tenant_id.to_string();
        let name = name.to_string();
        let email = email.to_string();
        let pool = Arc::clone(&self.pool);

        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

            let new_employee = NewEmployee { name: &name, email: &email, monthly_working_hours, tenant_id: &tenant_id };

            diesel::insert_into(employees::table)
                .values(&new_employee)
                .get_result::<models::Employee>(&mut conn)
                .map_err(|e| match e {
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
                    DieselError::NotFound => AppError::NotFound,
                    _ => AppError::DbError,
                })
                .map(|e| Employee {
                    id: e.id,
                    name: e.name,
                    email: e.email,
                    monthly_working_hours: e.monthly_working_hours,
                    available_shifts: vec![],
                    capabilities: vec![],
                })
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_employee(&self, tenant_id: &str, id: Uuid) -> Result<Option<Employee>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let employee = employees::table
                .filter(employees::id.eq(id))
                .filter(employees::tenant_id.eq(&tenant_id))
                .first::<models::Employee>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;

            match employee {
                Some(e) => {
                    // Load available shifts
                    let available_shifts = employee_available_shifts::table
                        .filter(employee_available_shifts::employee_id.eq(id))
                        .filter(employee_available_shifts::tenant_id.eq(&tenant_id))
                        .inner_join(shifts::table)
                        .select(shifts::all_columns)
                        .load::<models::Shift>(&mut conn)
                        .map_err(|_| AppError::DbError)?;

                    let available_shifts = available_shifts
                        .into_iter()
                        .map(|s| Shift { id: s.id, name: s.name, short_name: s.short_name, color: s.color, order: s.order, weekday_times: vec![] })
                        .collect();

                    // Load capabilities
                    let capabilities = employee_capabilities::table
                        .filter(employee_capabilities::employee_id.eq(id))
                        .filter(employee_capabilities::tenant_id.eq(&tenant_id))
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                        .load::<models::Capability>(&mut conn)
                        .map_err(|_| AppError::DbError)?;

                    let capabilities = capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                        .collect();

                    Ok(Some(Employee {
                        id: e.id,
                        name: e.name,
                        email: e.email,
                        monthly_working_hours: e.monthly_working_hours,
                        available_shifts,
                        capabilities,
                    }))
                }
                None => Ok(None),
            }
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_employee_by_email(&self, tenant_id: &str, email: &str) -> Result<Option<Employee>, AppError> {
        let tenant_id = tenant_id.to_string();
        let email = email.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let employee = employees::table
                .filter(employees::email.eq(&email))
                .filter(employees::tenant_id.eq(&tenant_id))
                .first::<models::Employee>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;

            match employee {
                Some(e) => {
                    // Load available shifts
                    let available_shifts = employee_available_shifts::table
                        .filter(employee_available_shifts::employee_id.eq(e.id))
                        .filter(employee_available_shifts::tenant_id.eq(&tenant_id))
                        .inner_join(shifts::table)
                        .select(shifts::all_columns)
                         .load::<models::Shift>(&mut conn)
                         .map_err(|_| AppError::DbError)?;

                    let available_shifts = available_shifts
                        .into_iter()
                        .map(|s| Shift { id: s.id, name: s.name, short_name: s.short_name, color: s.color, order: s.order, weekday_times: vec![] })
                        .collect();

                    // Load capabilities
                    let capabilities = employee_capabilities::table
                        .filter(employee_capabilities::employee_id.eq(e.id))
                        .filter(employee_capabilities::tenant_id.eq(&tenant_id))
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                         .load::<models::Capability>(&mut conn)
                         .map_err(|_| AppError::DbError)?;

                    let capabilities = capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                        .collect();

                    Ok(Some(Employee {
                        id: e.id,
                        name: e.name,
                        email: e.email,
                        monthly_working_hours: e.monthly_working_hours,
                        available_shifts,
                        capabilities,
                    }))
                }
                None => Ok(None),
            }
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_employees(&self, tenant_id: &str, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<Employee>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = employees::table.filter(employees::tenant_id.eq(&tenant_id)).into_boxed();

            if let Some(l) = limit {
                query = query.limit(l);
            }
            if let Some(o) = offset {
                query = query.offset(o);
            }

            let employees_list = query
                .load::<models::Employee>(&mut conn)
                .map_err(|_| AppError::DbError)?;

            let mut result = vec![];
            for e in employees_list {
                // Similar to get_employee, load shifts and capabilities
                let available_shifts = employee_available_shifts::table
                    .filter(employee_available_shifts::employee_id.eq(e.id))
                    .filter(employee_available_shifts::tenant_id.eq(&tenant_id))
                    .inner_join(shifts::table)
                    .select(shifts::all_columns)
                     .load::<models::Shift>(&mut conn)
                     .map_err(|_| AppError::DbError)?;

                let available_shifts = available_shifts
                    .into_iter()
                    .map(|s| Shift { id: s.id, name: s.name, short_name: s.short_name, color: s.color, order: s.order, weekday_times: vec![] })
                    .collect();

                let capabilities = employee_capabilities::table
                    .filter(employee_capabilities::employee_id.eq(e.id))
                    .filter(employee_capabilities::tenant_id.eq(&tenant_id))
                    .inner_join(capabilities::table)
                    .select(capabilities::all_columns)
                     .load::<models::Capability>(&mut conn)
                     .map_err(|_| AppError::DbError)?;

                let capabilities = capabilities
                    .into_iter()
                    .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                    .collect();

                result.push(Employee {
                    id: e.id,
                    name: e.name,
                    email: e.email,
                    monthly_working_hours: e.monthly_working_hours,
                    available_shifts,
                    capabilities,
                });
            }
            Ok(result)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_employees_by_ids(&self, tenant_id: &str, ids: &[Uuid]) -> Result<Vec<Employee>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let ids = ids.to_vec();
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

            let employees_list = employees::table
                .filter(employees::id.eq_any(&ids))
                .filter(employees::tenant_id.eq(&tenant_id))
                .load::<models::Employee>(&mut conn)
                .map_err(|_| AppError::DbError)?;

            let mut result = vec![];
            for e in employees_list {
                // Load available shifts
                let available_shifts = employee_available_shifts::table
                    .filter(employee_available_shifts::employee_id.eq(e.id))
                    .filter(employee_available_shifts::tenant_id.eq(&tenant_id))
                    .inner_join(shifts::table)
                    .select(shifts::all_columns)
                    .load::<models::Shift>(&mut conn)
                    .map_err(|_| AppError::DbError)?;

                let available_shifts = available_shifts
                    .into_iter()
                    .map(|s| Shift { id: s.id, name: s.name, short_name: s.short_name, color: s.color, order: s.order, weekday_times: vec![] })
                    .collect();

                // Load capabilities
                let capabilities = employee_capabilities::table
                    .filter(employee_capabilities::employee_id.eq(e.id))
                    .filter(employee_capabilities::tenant_id.eq(&tenant_id))
                    .inner_join(capabilities::table)
                    .select(capabilities::all_columns)
                    .load::<models::Capability>(&mut conn)
                    .map_err(|_| AppError::DbError)?;

                let capabilities = capabilities
                    .into_iter()
                    .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                    .collect();

                result.push(Employee {
                    id: e.id,
                    name: e.name,
                    email: e.email,
                    monthly_working_hours: e.monthly_working_hours,
                    available_shifts,
                    capabilities,
                });
            }
            Ok(result)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn count_employees(&self, tenant_id: &str) -> Result<i64, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let count = employees::table
                .filter(employees::tenant_id.eq(&tenant_id))
                .count()
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(count)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_employee_capabilities(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<Capability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

            let capabilities = employee_capabilities::table
                .filter(employee_capabilities::employee_id.eq(employee_id))
                .filter(employee_capabilities::tenant_id.eq(&tenant_id))
                .inner_join(capabilities::table)
                .select(capabilities::all_columns)
                .load::<models::Capability>(&mut conn)
                .map_err(|_| AppError::DbError)?
                .into_iter()
                .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                .collect();

            Ok(capabilities)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn add_employee_capability(&self, tenant_id: &str, employee_id: Uuid, capability_id: Uuid) -> Result<(), AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_employee_capability = NewEmployeeCapability { employee_id, capability_id, tenant_id: tenant_id.to_string() };

        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(employee_capabilities::table)
                .values(&new_employee_capability)
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_employee(&self, tenant_id: &str, employee: Employee) -> Result<(), AppError> {
        // Update employee fields (name, email, monthly_working_hours) in DB
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let emp_id = employee.id;
        let emp_name = employee.name.clone();
        let emp_email = employee.email.clone();
        let emp_monthly_working_hours = employee.monthly_working_hours;
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                employees::table
                    .filter(employees::id.eq(emp_id))
                    .filter(employees::tenant_id.eq(&tenant_id)),
            )
                .set((
                    employees::name.eq(emp_name),
                    employees::email.eq(emp_email),
                    employees::monthly_working_hours.eq(emp_monthly_working_hours),
                ))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_employee(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                employees::table
                    .filter(employees::id.eq(id))
                    .filter(employees::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_employee_available_shifts(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<Shift>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

            let available_shifts = employee_available_shifts::table
                .filter(employee_available_shifts::employee_id.eq(employee_id))
                .filter(employee_available_shifts::tenant_id.eq(&tenant_id))
                .inner_join(shifts::table)
                .select(shifts::all_columns)
                .load::<models::Shift>(&mut conn)
                .map_err(|_| AppError::DbError)?;

            let available_shifts = available_shifts
                .into_iter()
                .map(|s| Shift { id: s.id, name: s.name, short_name: s.short_name, color: s.color, order: s.order, weekday_times: vec![] })
                .collect();

            Ok(available_shifts)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn add_employee_available_shift(&self, tenant_id: &str, employee_id: Uuid, shift_id: Uuid) -> Result<(), AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_entry = NewEmployeeAvailableShift { employee_id, shift_id, tenant_id: tenant_id.to_string() };

        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(employee_available_shifts::table)
                .values(&new_entry)
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}


// Implement CapabilityRepository and UnavailabilityRepository similarly
#[derive(Clone)]
pub struct DieselCapabilityRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl CapabilityRepository for DieselCapabilityRepository {
    async fn create_capability(&self, tenant_id: &str, name: &str, level: i16, skill_group: Option<&str>) -> Result<Capability, AppError> {
        let tenant_id = tenant_id.to_string();
        let name = name.to_string();
        let skill_group = skill_group.map(|s| s.to_string());
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_capability = NewCapability { name: &name, tenant_id: &tenant_id, level, skill_group: skill_group.as_deref() };
            diesel::insert_into(capabilities::table)
                .values(&new_capability)
                .get_result::<models::Capability>(&mut conn)
                .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                .map_err(|e| match e {
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
                    _ => AppError::DbError,
                })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_capability(&self, tenant_id: &str, id: Uuid) -> Result<Option<Capability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            capabilities::table
                .filter(capabilities::id.eq(id))
                .filter(capabilities::tenant_id.eq(&tenant_id))
                .first::<models::Capability>(&mut conn)
                .optional()
                .map(|c: Option<models::Capability>| c.map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() }))
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_capabilities(&self, tenant_id: &str) -> Result<Vec<Capability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            capabilities::table
                .filter(capabilities::tenant_id.eq(&tenant_id))
                .load::<models::Capability>(&mut conn)
                .map(|caps: Vec<models::Capability>| caps.into_iter().map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() }).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_capability(&self, tenant_id: &str, id: Uuid, name: &str, level: i16, skill_group: Option<&str>) -> Result<Capability, AppError> {
        let tenant_id = tenant_id.to_string();
        let name = name.to_string();
        let skill_group = skill_group.map(|s| s.to_string());
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                capabilities::table
                    .filter(capabilities::id.eq(id))
                    .filter(capabilities::tenant_id.eq(&tenant_id)),
            )
                .set((
                    capabilities::name.eq(&name),
                    capabilities::level.eq(level),
                    capabilities::skill_group.eq(&skill_group),
                ))
                .get_result::<models::Capability>(&mut conn)
                .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                .map_err(|e| match e {
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
                    DieselError::NotFound => AppError::NotFound,
                    _ => AppError::DbError,
                })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_capability(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            // First delete all references in employee_capabilities
            diesel::delete(
                employee_capabilities::table
                    .filter(employee_capabilities::capability_id.eq(id))
                    .filter(employee_capabilities::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            // Delete all references in workstation_required_capabilities
            diesel::delete(
                workstation_required_capabilities::table
                    .filter(workstation_required_capabilities::capability_id.eq(id))
                    .filter(workstation_required_capabilities::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            // Then delete the capability itself
            diesel::delete(
                capabilities::table
                    .filter(capabilities::id.eq(id))
                    .filter(capabilities::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

#[derive(Clone)]
pub struct DieselUnavailabilityRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl UnavailabilityRepository for DieselUnavailabilityRepository {
    async fn create_unavailability(&self, tenant_id: &str, unavailability: Unavailability) -> Result<Unavailability, AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_unavailability = NewUnavailability {
            employee_id: unavailability.employee_id,
            unavailable_date: unavailability.unavailable_date,
            shift_id: unavailability.shift_id,
            tenant_id: tenant_id.to_string(),
            is_soft_preference: unavailability.is_soft_preference,
        };
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let created = diesel::insert_into(unavailabilities::table)
                .values(&new_unavailability)
                .get_result::<models::Unavailability>(&mut conn)
                .map(|u| Unavailability {
                    id: u.id,
                    employee_id: u.employee_id,
                    unavailable_date: u.unavailable_date,
                    shift_id: u.shift_id,
                    is_soft_preference: u.is_soft_preference,
                })
                .map_err(|e| match e {
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
                    _ => AppError::DbError,
                })?;
            Ok(created)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_unavailability(&self, tenant_id: &str, id: Uuid) -> Result<Option<Unavailability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            unavailabilities::table
                .filter(unavailabilities::id.eq(id))
                .filter(unavailabilities::tenant_id.eq(&tenant_id))
                .first::<models::Unavailability>(&mut conn)
                .optional()
                .map(|u: Option<models::Unavailability>| u.map(|u| Unavailability {
                    id: u.id,
                    employee_id: u.employee_id,
                    unavailable_date: u.unavailable_date,
                    shift_id: u.shift_id,
                    is_soft_preference: u.is_soft_preference,
                }))
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_unavailabilities(&self, tenant_id: &str) -> Result<Vec<Unavailability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            unavailabilities::table
                .filter(unavailabilities::tenant_id.eq(&tenant_id))
                .load::<models::Unavailability>(&mut conn)
                .map(|unavs: Vec<models::Unavailability>| unavs.into_iter().map(|u| Unavailability {
                    id: u.id,
                    employee_id: u.employee_id,
                    unavailable_date: u.unavailable_date,
                    shift_id: u.shift_id,
                    is_soft_preference: u.is_soft_preference,
                }).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_unavailabilities_for_employee(&self, tenant_id: &str, employee_id: Uuid) -> Result<Vec<Unavailability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            unavailabilities::table
                .filter(unavailabilities::employee_id.eq(employee_id))
                .filter(unavailabilities::tenant_id.eq(&tenant_id))
                .load::<models::Unavailability>(&mut conn)
                .map(|unavs: Vec<models::Unavailability>| unavs.into_iter().map(|u| Unavailability {
                    id: u.id,
                    employee_id: u.employee_id,
                    unavailable_date: u.unavailable_date,
                    shift_id: u.shift_id,
                    is_soft_preference: u.is_soft_preference,
                }).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_unavailability(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                unavailabilities::table
                    .filter(unavailabilities::id.eq(id))
                    .filter(unavailabilities::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

#[derive(Clone)]
pub struct DieselWorkstationRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl crate::repository::domain::WorkstationRepository for DieselWorkstationRepository {
    async fn create_workstation(&self, tenant_id: &str, name: &str, available: bool, active_shift_ids: Vec<Uuid>, priority: &str, min_employees: i16, max_employees: Option<i16>) -> Result<crate::repository::domain::Workstation, AppError> {
        let tenant_id = tenant_id.to_string();
        let name = name.to_string();
        let priority = priority.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_workstation = NewWorkstation { name: &name, available, active_shift_ids, priority: &priority, min_employees, max_employees, tenant_id: &tenant_id };
            diesel::insert_into(workstations::table)
                .values(&new_workstation)
                .get_result::<models::Workstation>(&mut conn)
                .map(|ws| Workstation {
                    id: ws.id,
                    name: ws.name,
                    available: ws.available,
                    active_shift_ids: ws.active_shift_ids,
                    required_capabilities: vec![],
                    priority: ws.priority,
                    min_employees: ws.min_employees,
                    max_employees: ws.max_employees,
                })
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_workstation(&self, tenant_id: &str, id: Uuid) -> Result<Option<crate::repository::domain::Workstation>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let workstation = workstations::table
                .filter(workstations::id.eq(id))
                .filter(workstations::tenant_id.eq(&tenant_id))
                .first::<models::Workstation>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;

            match workstation {
                Some(ws) => {
                    let required_capabilities = workstation_required_capabilities::table
                        .filter(workstation_required_capabilities::workstation_id.eq(id))
                        .filter(workstation_required_capabilities::tenant_id.eq(&tenant_id))
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                        .load::<models::Capability>(&mut conn)
                        .map_err(|_| AppError::DbError)?;

                    let required_capabilities = required_capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                        .collect();

                    Ok(Some(Workstation {
                        id: ws.id,
                        name: ws.name,
                        available: ws.available,
                        active_shift_ids: ws.active_shift_ids,
                        required_capabilities,
                        priority: ws.priority,
                        min_employees: ws.min_employees,
                        max_employees: ws.max_employees,
                    }))
                }
                None => Ok(None),
            }
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_workstations(&self, tenant_id: &str) -> Result<Vec<crate::repository::domain::Workstation>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let workstations_list = workstations::table
                .filter(workstations::tenant_id.eq(&tenant_id))
                .load::<models::Workstation>(&mut conn)
                .map_err(|_| AppError::DbError)?;

            let mut result = vec![];
            for ws in workstations_list {
                let required_capabilities = workstation_required_capabilities::table
                    .filter(workstation_required_capabilities::workstation_id.eq(ws.id))
                    .filter(workstation_required_capabilities::tenant_id.eq(&tenant_id))
                    .inner_join(capabilities::table)
                    .select(capabilities::all_columns)
                    .load::<models::Capability>(&mut conn)
                    .map_err(|_| AppError::DbError)?;

                let required_capabilities = required_capabilities
                    .into_iter()
                    .map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() })
                    .collect();

                result.push(Workstation {
                    id: ws.id,
                    name: ws.name,
                    available: ws.available,
                    active_shift_ids: ws.active_shift_ids,
                    required_capabilities,
                    priority: ws.priority,
                    min_employees: ws.min_employees,
                    max_employees: ws.max_employees,
                });
            }
            Ok(result)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn set_workstation_availability(&self, tenant_id: &str, id: Uuid, available: bool) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                workstations::table
                    .filter(workstations::id.eq(id))
                    .filter(workstations::tenant_id.eq(&tenant_id)),
            )
                .set(workstations::available.eq(available))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn set_workstation_active_shifts(&self, tenant_id: &str, id: Uuid, active_shift_ids: Vec<Uuid>) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                workstations::table
                    .filter(workstations::id.eq(id))
                    .filter(workstations::tenant_id.eq(&tenant_id)),
            )
                .set(workstations::active_shift_ids.eq(active_shift_ids))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn set_workstation_priority(&self, tenant_id: &str, id: Uuid, priority: &str) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let priority = priority.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                workstations::table
                    .filter(workstations::id.eq(id))
                    .filter(workstations::tenant_id.eq(&tenant_id)),
            )
                .set(workstations::priority.eq(priority))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn set_workstation_staffing(&self, tenant_id: &str, id: Uuid, min_employees: i16, max_employees: Option<i16>) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(
                workstations::table
                    .filter(workstations::id.eq(id))
                    .filter(workstations::tenant_id.eq(&tenant_id)),
            )
                .set((
                    workstations::min_employees.eq(min_employees),
                    workstations::max_employees.eq(max_employees),
                ))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn add_required_capability(&self, tenant_id: &str, workstation_id: Uuid, capability_id: Uuid) -> Result<(), AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_link = NewWorkstationRequiredCapability { workstation_id, capability_id, tenant_id: tenant_id.to_string() };
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(workstation_required_capabilities::table)
                .values(&new_link)
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_required_capabilities(&self, tenant_id: &str, workstation_id: Uuid) -> Result<Vec<Capability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            workstation_required_capabilities::table
                .filter(workstation_required_capabilities::workstation_id.eq(workstation_id))
                .filter(workstation_required_capabilities::tenant_id.eq(&tenant_id))
                .inner_join(capabilities::table)
                .select(capabilities::all_columns)
                .load::<models::Capability>(&mut conn)
                .map(|caps: Vec<models::Capability>| caps.into_iter().map(|c| Capability { id: c.id, name: c.name, level: c.level, skill_group: c.skill_group.clone() }).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_workstation(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            // First delete all required capabilities for this workstation
            diesel::delete(
                workstation_required_capabilities::table
                    .filter(workstation_required_capabilities::workstation_id.eq(id))
                    .filter(workstation_required_capabilities::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            // Then delete the workstation itself
            diesel::delete(
                workstations::table
                    .filter(workstations::id.eq(id))
                    .filter(workstations::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn remove_required_capability(&self, tenant_id: &str, workstation_id: Uuid, capability_id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                workstation_required_capabilities::table
                    .filter(workstation_required_capabilities::workstation_id.eq(workstation_id))
                    .filter(workstation_required_capabilities::capability_id.eq(capability_id))
                    .filter(workstation_required_capabilities::tenant_id.eq(&tenant_id))
            )
            .execute(&mut conn)
            .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

#[derive(Clone)]
pub struct DieselWorkstationUnavailabilityRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl crate::repository::domain::WorkstationUnavailabilityRepository for DieselWorkstationUnavailabilityRepository {
    async fn create_workstation_unavailability(&self, tenant_id: &str, unavailability: WorkstationUnavailability) -> Result<WorkstationUnavailability, AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_unavailability = NewWorkstationUnavailability {
            workstation_id: unavailability.workstation_id,
            unavailable_from: unavailability.unavailable_from,
            unavailable_to: unavailability.unavailable_to,
            tenant_id: tenant_id.to_string(),
        };
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(workstation_unavailabilities::table)
                .values(&new_unavailability)
                .get_result::<models::WorkstationUnavailability>(&mut conn)
                .map(|u| WorkstationUnavailability {
                    id: u.id,
                    workstation_id: u.workstation_id,
                    unavailable_from: u.unavailable_from,
                    unavailable_to: u.unavailable_to,
                })
                .map_err(|e| match e {
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
                    _ => AppError::DbError,
                })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_workstation_unavailability(&self, tenant_id: &str, id: Uuid) -> Result<Option<WorkstationUnavailability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            workstation_unavailabilities::table
                .filter(workstation_unavailabilities::id.eq(id))
                .filter(workstation_unavailabilities::tenant_id.eq(&tenant_id))
                .first::<models::WorkstationUnavailability>(&mut conn)
                .optional()
                .map(|u: Option<models::WorkstationUnavailability>| u.map(|u| WorkstationUnavailability {
                    id: u.id,
                    workstation_id: u.workstation_id,
                    unavailable_from: u.unavailable_from,
                    unavailable_to: u.unavailable_to,
                }))
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_workstation_unavailabilities(&self, tenant_id: &str) -> Result<Vec<WorkstationUnavailability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            workstation_unavailabilities::table
                .filter(workstation_unavailabilities::tenant_id.eq(&tenant_id))
                .load::<models::WorkstationUnavailability>(&mut conn)
                .map(|unavs: Vec<models::WorkstationUnavailability>| unavs.into_iter().map(|u| WorkstationUnavailability {
                    id: u.id,
                    workstation_id: u.workstation_id,
                    unavailable_from: u.unavailable_from,
                    unavailable_to: u.unavailable_to,
                }).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_unavailabilities_for_workstation(&self, tenant_id: &str, workstation_id: Uuid) -> Result<Vec<WorkstationUnavailability>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            workstation_unavailabilities::table
                .filter(workstation_unavailabilities::workstation_id.eq(workstation_id))
                .filter(workstation_unavailabilities::tenant_id.eq(&tenant_id))
                .load::<models::WorkstationUnavailability>(&mut conn)
                .map(|unavs: Vec<models::WorkstationUnavailability>| unavs.into_iter().map(|u| WorkstationUnavailability {
                    id: u.id,
                    workstation_id: u.workstation_id,
                    unavailable_from: u.unavailable_from,
                    unavailable_to: u.unavailable_to,
                }).collect())
                .map_err(|_| AppError::DbError)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_workstation_unavailability(&self, tenant_id: &str, id: Uuid) -> Result<(), AppError> {
        let tenant_id = tenant_id.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        telemetry::db_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                workstation_unavailabilities::table
                    .filter(workstation_unavailabilities::id.eq(id))
                    .filter(workstation_unavailabilities::tenant_id.eq(&tenant_id)),
            )
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
