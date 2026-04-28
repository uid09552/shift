use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use tokio::task;
use uuid::Uuid;
use crate::errors::AppError;
use diesel::result::{Error as DieselError, DatabaseErrorKind};

use crate::database::DbPool;
use crate::repository::domain::{
    CapabilityRepository, Capability, Employee, EmployeeRepository, Shift, ShiftRepository,
    Unavailability, UnavailabilityRepository, Workstation,
};
use crate::models::{
    NewCapability, NewEmployee, NewEmployeeCapability, NewShift, NewUnavailability, NewWorkstation,
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
) -> Result<Employee, AppError> {
    let name = name.to_string();
    let email = email.to_string();
    let pool = Arc::clone(&self.pool);

    task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|_| AppError::DbError)?;

        let new_employee = NewEmployee { name: &name, email: &email };

        diesel::insert_into(employees::table)
            .values(&new_employee)
            .get_result::<models::Employee>(&mut conn)
            .map_err(|e| match e {
                DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => {
                    AppError::Duplicate
                }
                DieselError::NotFound => AppError::NotFound,
                _ => AppError::DbError,
            })
            .map(|e| Employee {
                id: e.id,
                name: e.name,
                email: e.email,
                available_shifts: vec![],
                capabilities: vec![],
            })
    })
    .await
    .map_err(|_| AppError::Internal)?
}

    async fn get_employee(&self, id: Uuid) -> Result<Option<Employee>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let employee = employees::table
                .find(id)
                .first::<models::Employee>(&mut conn)
                .optional()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            match employee {
                Some(e) => {
                    // Load available shifts
                    let available_shifts = employee_available_shifts::table
                        .filter(employee_available_shifts::employee_id.eq(id))
                        .inner_join(shifts::table)
                        .select(shifts::all_columns)
                        .load::<models::Shift>(&mut conn)?;

                    let available_shifts = available_shifts
                        .into_iter()
                        .map(|s| Shift { id: s.id, name: s.name })
                        .collect();

                    // Load capabilities
                    let capabilities = employee_capabilities::table
                        .filter(employee_capabilities::employee_id.eq(id))
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                        .load::<models::Capability>(&mut conn)?;

                    let capabilities = capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name })
                        .collect();

                    Ok(Some(Employee {
                        id: e.id,
                        name: e.name,
                        email: e.email,
                        available_shifts,
                        capabilities,
                    }))
                }
                None => Ok(None),
            }
        })
        .await?
    }

    async fn get_employee_by_email(&self, email: &str) -> Result<Option<Employee>, Box<dyn std::error::Error + Send + Sync>> {
        let email = email.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let employee = employees::table
                .filter(employees::email.eq(&email))
                .first::<models::Employee>(&mut conn)
                .optional()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            match employee {
                Some(e) => {
                    // Load available shifts
                    let available_shifts = employee_available_shifts::table
                        .filter(employee_available_shifts::employee_id.eq(e.id))
                        .inner_join(shifts::table)
                        .select(shifts::all_columns)
                        .load::<models::Shift>(&mut conn)?;

                    let available_shifts = available_shifts
                        .into_iter()
                        .map(|s| Shift { id: s.id, name: s.name })
                        .collect();

                    // Load capabilities
                    let capabilities = employee_capabilities::table
                        .filter(employee_capabilities::employee_id.eq(e.id))
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                        .load::<models::Capability>(&mut conn)?;

                    let capabilities = capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name })
                        .collect();

                    Ok(Some(Employee {
                        id: e.id,
                        name: e.name,
                        email: e.email,
                        available_shifts,
                        capabilities,
                    }))
                }
                None => Ok(None),
            }
        })
        .await?
    }

    async fn list_employees(&self) -> Result<Vec<Employee>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let employees_list = employees::table
                .load::<models::Employee>(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            let mut result = vec![];
            for e in employees_list {
                // Similar to get_employee, load shifts and capabilities
                let available_shifts = employee_available_shifts::table
                    .filter(employee_available_shifts::employee_id.eq(e.id))
                    .inner_join(shifts::table)
                    .select(shifts::all_columns)
                    .load::<models::Shift>(&mut conn)?;

                let available_shifts = available_shifts
                    .into_iter()
                    .map(|s| Shift { id: s.id, name: s.name })
                    .collect();

                let capabilities = employee_capabilities::table
                    .filter(employee_capabilities::employee_id.eq(e.id))
                    .inner_join(capabilities::table)
                    .select(capabilities::all_columns)
                    .load::<models::Capability>(&mut conn)?;

                let capabilities = capabilities
                    .into_iter()
                    .map(|c| Capability { id: c.id, name: c.name })
                    .collect();

                result.push(Employee {
                    id: e.id,
                    name: e.name,
                    email: e.email,
                    available_shifts,
                    capabilities,
                });
            }
            Ok(result)
        })
        .await?
    }

    async fn get_employee_capabilities(&self, employee_id: Uuid) -> Result<Vec<Capability>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            let capabilities = employee_capabilities::table
                .filter(employee_capabilities::employee_id.eq(employee_id))
                .inner_join(capabilities::table)
                .select(capabilities::all_columns)
                .load::<models::Capability>(&mut conn)?
                .into_iter()
                .map(|c| Capability { id: c.id, name: c.name })
                .collect();

            Ok(capabilities)
        })
        .await?
    }

    async fn add_employee_capability(&self, employee_id: Uuid, capability_id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_employee_capability = NewEmployeeCapability { employee_id, capability_id };

        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::insert_into(employee_capabilities::table)
                .values(&new_employee_capability)
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }

    async fn update_employee(&self, _employee: Employee) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // TODO: Implement update
        Ok(())
    }

    async fn delete_employee(&self, id: Uuid) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::delete(employees::table.find(id))
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }
}

// Implement other repositories similarly
#[derive(Clone)]
pub struct DieselShiftRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl ShiftRepository for DieselShiftRepository {
    async fn create_shift(&self, name: &str) -> Result<Shift, Box<dyn std::error::Error + Send + Sync>> {
        let name = name.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let new_shift = NewShift { name: &name };
            diesel::insert_into(shifts::table)
                .values(&new_shift)
                .get_result::<models::Shift>(&mut conn)
                .map(|s| Shift { id: s.id, name: s.name })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn get_shift(&self, id: Uuid) -> Result<Option<Shift>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            shifts::table
                .find(id)
                .first::<models::Shift>(&mut conn)
                .optional()
                .map(|s: Option<models::Shift>| s.map(|s| Shift { id: s.id, name: s.name }))
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
    }

    async fn list_shifts(&self) -> Result<Vec<Shift>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            shifts::table
                .load::<models::Shift>(&mut conn)
                .map(|shifts: Vec<models::Shift>| shifts.into_iter().map(|s| Shift { id: s.id, name: s.name }).collect())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        })
        .await?
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
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
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
}

#[derive(Clone)]
pub struct DieselUnavailabilityRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl UnavailabilityRepository for DieselUnavailabilityRepository {
    async fn create_unavailability(&self, unavailability: Unavailability) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        let new_unavailability = NewUnavailability {
            employee_id: unavailability.employee_id,
            unavailable_date: unavailability.unavailable_date,
            shift_id: unavailability.shift_id,
        };
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::insert_into(unavailabilities::table)
                .values(&new_unavailability)
                .execute(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(())
        })
        .await?
    }

    async fn get_unavailabilities_for_employee(&self, employee_id: Uuid) -> Result<Vec<Unavailability>, Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
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
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
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
    async fn create_workstation(&self, name: &str, available: bool, active_shift_id: Option<Uuid>) -> Result<crate::repository::domain::Workstation, Box<dyn std::error::Error + Send + Sync>> {
        let name = name.to_string();
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let new_workstation = NewWorkstation { name: &name, available, active_shift_id };
            diesel::insert_into(workstations::table)
                .values(&new_workstation)
                .get_result::<models::Workstation>(&mut conn)
                .map(|ws| Workstation {
                    id: ws.id,
                    name: ws.name,
                    available: ws.available,
                    active_shift_id: ws.active_shift_id,
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
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            match workstation {
                Some(ws) => {
                    let required_capabilities = workstation_required_capabilities::table
                        .filter(workstation_required_capabilities::workstation_id.eq(id))
                        .inner_join(capabilities::table)
                        .select(capabilities::all_columns)
                        .load::<models::Capability>(&mut conn)
                        .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

                    let required_capabilities = required_capabilities
                        .into_iter()
                        .map(|c| Capability { id: c.id, name: c.name })
                        .collect();

                    Ok(Some(Workstation {
                        id: ws.id,
                        name: ws.name,
                        available: ws.available,
                        active_shift_id: ws.active_shift_id,
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
                    .load::<models::Capability>(&mut conn)?;

                let required_capabilities = required_capabilities
                    .into_iter()
                    .map(|c| Capability { id: c.id, name: c.name })
                    .collect();

                result.push(Workstation {
                    id: ws.id,
                    name: ws.name,
                    available: ws.available,
                    active_shift_id: ws.active_shift_id,
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

    async fn set_workstation_active_shift(&self, id: Uuid, active_shift_id: Option<Uuid>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let pool: Arc<DbPool> = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            diesel::update(workstations::table.find(id))
                .set(workstations::active_shift_id.eq(active_shift_id))
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
}
