use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use tokio::task;
use uuid::Uuid;
use crate::errors::AppError;
use diesel::result::{Error as DieselError, DatabaseErrorKind};

use crate::database::DbPool;
use crate::repository::domain::{
    CapabilityRepository, Capability, Employee, EmployeeRepository, Shift,
    Unavailability, UnavailabilityRepository, Workstation,
};
use crate::models::{
    NewCapability, NewEmployee, NewEmployeeAvailableShift, NewEmployeeCapability, NewUnavailability, NewWorkstation,
    NewWorkstationRequiredCapability,
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
};

#[derive(Clone)]
pub struct DieselEmployeeRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl EmployeeRepository for DieselEmployeeRepository {
    async fn create_employee(
    &self,
    name: &str,
    email: &str,
    monthly_working_hours: f64,
    ) -> Result<Employee, AppError> {
    let name = name.to_string();
    let email = email.to_string();
    let pool = Arc::clone(&self.pool);

        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

        let new_employee = NewEmployee { name: &name, email: &email, monthly_working_hours };

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

    async fn get_employee(&self, id: Uuid) -> Result<Option<Employee>, AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let employee = employees::table
                .find(id)
                .first::<models::Employee>(&mut conn)
                .optional()
            .map_err(|_| AppError::DbError)?;

            match employee {
                Some(e) => {
                    // Load available shifts
                    let available_shifts = employee_available_shifts::table
                        .filter(employee_available_shifts::employee_id.eq(id))
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
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                        .load::<models::Capability>(&mut conn)
                        .map_err(|_| AppError::DbError)?;

                    let capabilities = capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name })
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

    async fn get_employee_by_email(&self, email: &str) -> Result<Option<Employee>, AppError> {
        let email = email.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let employee = employees::table
                .filter(employees::email.eq(&email))
                .first::<models::Employee>(&mut conn)
                .optional()
            .map_err(|_| AppError::DbError)?;

            match employee {
                Some(e) => {
                    // Load available shifts
                    let available_shifts = employee_available_shifts::table
                        .filter(employee_available_shifts::employee_id.eq(e.id))
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
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                         .load::<models::Capability>(&mut conn)
                         .map_err(|_| AppError::DbError)?;

                    let capabilities = capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name })
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

    async fn list_employees(&self, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<Employee>, AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let mut query = employees::table.into_boxed();

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
                    .inner_join(capabilities::table)
                    .select(capabilities::all_columns)
                     .load::<models::Capability>(&mut conn)
                     .map_err(|_| AppError::DbError)?;

                let capabilities = capabilities
                    .into_iter()
                    .map(|c| Capability { id: c.id, name: c.name })
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

    async fn count_employees(&self) -> Result<i64, AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let count = employees::table
                .count()
                .get_result(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(count)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_employee_capabilities(&self, employee_id: Uuid) -> Result<Vec<Capability>, AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

            let capabilities = employee_capabilities::table
                .filter(employee_capabilities::employee_id.eq(employee_id))
                .inner_join(capabilities::table)
                .select(capabilities::all_columns)
                .load::<models::Capability>(&mut conn)
                .map_err(|_| AppError::DbError)?
                .into_iter()
                .map(|c| Capability { id: c.id, name: c.name })
                .collect();

            Ok(capabilities)
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn add_employee_capability(&self, employee_id: Uuid, capability_id: Uuid) -> Result<(), AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_employee_capability = NewEmployeeCapability { employee_id, capability_id };

        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::insert_into(employee_capabilities::table)
                .values(&new_employee_capability)
                .execute(&mut conn)
            .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn update_employee(&self, employee: Employee) -> Result<(), AppError> {
        // Update employee fields (name, email, monthly_working_hours) in DB
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let emp_id = employee.id;
        let emp_name = employee.name.clone();
        let emp_email = employee.email.clone();
        let emp_monthly_working_hours = employee.monthly_working_hours;
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::update(crate::schema::employees::table.find(emp_id))
                .set((
                    crate::schema::employees::name.eq(emp_name),
                    crate::schema::employees::email.eq(emp_email),
                    crate::schema::employees::monthly_working_hours.eq(emp_monthly_working_hours),
                ))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn delete_employee(&self, id: Uuid) -> Result<(), AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(employees::table.find(id))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_employee_available_shifts(&self, employee_id: Uuid) -> Result<Vec<Shift>, AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

            let available_shifts = employee_available_shifts::table
                .filter(employee_available_shifts::employee_id.eq(employee_id))
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

    async fn add_employee_available_shift(&self, employee_id: Uuid, shift_id: Uuid) -> Result<(), AppError> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_entry = NewEmployeeAvailableShift { employee_id, shift_id };

        task::spawn_blocking(move || {
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
    async fn create_capability(&self, name: &str) -> Result<Capability, Box<dyn std::error::Error + Send + Sync>> {
        let name = name.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_capability = NewCapability { name: &name };
            diesel::insert_into(capabilities::table)
                .values(&new_capability)
                .get_result::<models::Capability>(&mut conn)
                .map(|c| Capability { id: c.id, name: c.name })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_capability(&self, id: Uuid) -> Result<Option<Capability>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            capabilities::table
                .find(id)
                .first::<models::Capability>(&mut conn)
                .optional()
                .map(|c: Option<models::Capability>| c.map(|c| Capability { id: c.id, name: c.name }))
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn list_capabilities(&self) -> Result<Vec<Capability>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            capabilities::table
                .load::<models::Capability>(&mut conn)
                .map(|caps: Vec<models::Capability>| caps.into_iter().map(|c| Capability { id: c.id, name: c.name }).collect())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn delete_capability(&self, id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            // First delete all references in employee_capabilities
            diesel::delete(employee_capabilities::table.filter(employee_capabilities::capability_id.eq(id)))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            // Delete all references in workstation_required_capabilities
            diesel::delete(workstation_required_capabilities::table.filter(workstation_required_capabilities::capability_id.eq(id)))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            // Then delete the capability itself
            diesel::delete(capabilities::table.find(id))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }
}

#[derive(Clone)]
pub struct DieselUnavailabilityRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl UnavailabilityRepository for DieselUnavailabilityRepository {
    async fn create_unavailability(&self, unavailability: Unavailability) -> Result<Unavailability, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_unavailability = NewUnavailability {
            employee_id: unavailability.employee_id,
            unavailable_date: unavailability.unavailable_date,
            shift_id: unavailability.shift_id,
        };
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let created = diesel::insert_into(unavailabilities::table)
                .values(&new_unavailability)
                .get_result::<models::Unavailability>(&mut conn)
                .map(|u| Unavailability {
                    id: u.id,
                    employee_id: u.employee_id,
                    unavailable_date: u.unavailable_date,
                    shift_id: u.shift_id,
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(created)
        })
        .await?
    }

    async fn get_unavailability(&self, id: Uuid) -> Result<Option<Unavailability>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            unavailabilities::table
                .find(id)
                .first::<models::Unavailability>(&mut conn)
                .optional()
                .map(|u: Option<models::Unavailability>| u.map(|u| Unavailability {
                    id: u.id,
                    employee_id: u.employee_id,
                    unavailable_date: u.unavailable_date,
                    shift_id: u.shift_id,
                }))
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn list_unavailabilities(&self) -> Result<Vec<Unavailability>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            unavailabilities::table
                .load::<models::Unavailability>(&mut conn)
                .map(|unavs: Vec<models::Unavailability>| unavs.into_iter().map(|u| Unavailability {
                    id: u.id,
                    employee_id: u.employee_id,
                    unavailable_date: u.unavailable_date,
                    shift_id: u.shift_id,
                }).collect())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_unavailabilities_for_employee(&self, employee_id: Uuid) -> Result<Vec<Unavailability>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            unavailabilities::table
                .filter(unavailabilities::employee_id.eq(employee_id))
                .load::<models::Unavailability>(&mut conn)
                .map(|unavs: Vec<models::Unavailability>| unavs.into_iter().map(|u| Unavailability {
                    id: u.id,
                    employee_id: u.employee_id,
                    unavailable_date: u.unavailable_date,
                    shift_id: u.shift_id,
                }).collect())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn delete_unavailability(&self, id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::delete(unavailabilities::table.find(id))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await?
    }
}

#[derive(Clone)]
pub struct DieselWorkstationRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl crate::repository::domain::WorkstationRepository for DieselWorkstationRepository {
    async fn create_workstation(&self, name: &str, available: bool, active_shift_ids: Vec<Uuid>) -> Result<crate::repository::domain::Workstation, Box<dyn std::error::Error + Send + Sync>> {
        let name = name.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_workstation = NewWorkstation { name: &name, available, active_shift_ids };
            diesel::insert_into(workstations::table)
                .values(&new_workstation)
                .get_result::<models::Workstation>(&mut conn)
                .map(|ws| Workstation {
                    id: ws.id,
                    name: ws.name,
                    available: ws.available,
                    active_shift_ids: ws.active_shift_ids,
                    required_capabilities: vec![],
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_workstation(&self, id: Uuid) -> Result<Option<crate::repository::domain::Workstation>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let workstation = workstations::table
                .find(id)
                .first::<models::Workstation>(&mut conn)
                .optional()
                .map_err(|_| AppError::DbError)?;

            match workstation {
                Some(ws) => {
                    let required_capabilities = workstation_required_capabilities::table
                        .filter(workstation_required_capabilities::workstation_id.eq(id))
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                .load::<models::Capability>(&mut conn)
                .map_err(|_| AppError::DbError)?;

                    let required_capabilities = required_capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name })
                        .collect();

                    Ok(Some(Workstation {
                        id: ws.id,
                        name: ws.name,
                        available: ws.available,
                        active_shift_ids: ws.active_shift_ids,
                        required_capabilities,
                    }))
                }
                None => Ok(None),
            }
        })
        .await?
    }

    async fn list_workstations(&self) -> Result<Vec<crate::repository::domain::Workstation>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let workstations_list = workstations::table
                .load::<models::Workstation>(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            let mut result = vec![];
            for ws in workstations_list {
                let required_capabilities = workstation_required_capabilities::table
                    .filter(workstation_required_capabilities::workstation_id.eq(ws.id))
                    .inner_join(capabilities::table)
                    .select(capabilities::all_columns)
                    .load::<models::Capability>(&mut conn)
                    .map_err(|_| AppError::DbError)?;

                let required_capabilities = required_capabilities
                    .into_iter()
                    .map(|c| Capability { id: c.id, name: c.name })
                    .collect();

                result.push(Workstation {
                    id: ws.id,
                    name: ws.name,
                    available: ws.available,
                    active_shift_ids: ws.active_shift_ids,
                    required_capabilities,
                });
            }
            Ok(result)
        })
        .await?
    }

    async fn set_workstation_availability(&self, id: Uuid, available: bool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::update(workstations::table.find(id))
                .set(workstations::available.eq(available))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }

    async fn set_workstation_active_shifts(&self, id: Uuid, active_shift_ids: Vec<Uuid>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::update(workstations::table.find(id))
                .set(workstations::active_shift_ids.eq(active_shift_ids))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }

    async fn add_required_capability(&self, workstation_id: Uuid, capability_id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let new_link = NewWorkstationRequiredCapability { workstation_id, capability_id };
            diesel::insert_into(workstation_required_capabilities::table)
                .values(&new_link)
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }

    async fn list_required_capabilities(&self, workstation_id: Uuid) -> Result<Vec<Capability>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            workstation_required_capabilities::table
                .filter(workstation_required_capabilities::workstation_id.eq(workstation_id))
                .inner_join(capabilities::table)
                .select(capabilities::all_columns)
                .load::<models::Capability>(&mut conn)
                .map(|caps: Vec<models::Capability>| caps.into_iter().map(|c| Capability { id: c.id, name: c.name }).collect())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn delete_workstation(&self, id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            // First delete all required capabilities for this workstation
            diesel::delete(workstation_required_capabilities::table.filter(workstation_required_capabilities::workstation_id.eq(id)))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            // Then delete the workstation itself
            diesel::delete(workstations::table.find(id))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }

    async fn remove_required_capability(&self, workstation_id: Uuid, capability_id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::delete(
                workstation_required_capabilities::table
                    .filter(workstation_required_capabilities::workstation_id.eq(workstation_id))
                    .filter(workstation_required_capabilities::capability_id.eq(capability_id))
            )
            .execute(&mut conn)
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }
}
