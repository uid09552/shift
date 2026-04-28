pub mod domain;
pub mod employeerepository;
pub mod shiftrepository;

use std::sync::Arc;
use crate::database::DbPool;
use self::employeerepository::{
    DieselCapabilityRepository,
    DieselEmployeeRepository,
    DieselUnavailabilityRepository,
    DieselWorkstationRepository,
};
use self::shiftrepository::DieselShiftRepository;

#[derive(Clone)]
pub struct AppState {
    pub employee_repo: DieselEmployeeRepository,
    pub shift_repo: DieselShiftRepository,
    pub capability_repo: DieselCapabilityRepository,
    pub workstation_repo: DieselWorkstationRepository,
    pub unavailability_repo: DieselUnavailabilityRepository,
    pub pool: Arc<DbPool>,
}

impl AppState {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self {
            employee_repo: DieselEmployeeRepository { pool: Arc::clone(&pool) },
            shift_repo: DieselShiftRepository { pool: Arc::clone(&pool) },
            capability_repo: DieselCapabilityRepository { pool: Arc::clone(&pool) },
            workstation_repo: DieselWorkstationRepository { pool: Arc::clone(&pool) },
            unavailability_repo: DieselUnavailabilityRepository { pool: Arc::clone(&pool) },
            pool: pool,
          
        }
    }
}
