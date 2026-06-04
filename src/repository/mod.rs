pub mod domain;
pub mod employeerepository;
pub mod shiftrepository;

use std::sync::Arc;
use crate::database::DbPool;
use crate::broker::JetStreamStatus;
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
    pub nats_client: Option<async_nats::Client>,
    pub jetstream_status: JetStreamStatus,
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
            nats_client: None,
            jetstream_status: JetStreamStatus::Unavailable,
        }
    }

    pub fn with_nats(pool: Arc<DbPool>, nats_client: async_nats::Client, jetstream_status: JetStreamStatus) -> Self {
        Self {
            employee_repo: DieselEmployeeRepository { pool: Arc::clone(&pool) },
            shift_repo: DieselShiftRepository { pool: Arc::clone(&pool) },
            capability_repo: DieselCapabilityRepository { pool: Arc::clone(&pool) },
            workstation_repo: DieselWorkstationRepository { pool: Arc::clone(&pool) },
            unavailability_repo: DieselUnavailabilityRepository { pool: Arc::clone(&pool) },
            pool,
            nats_client: Some(nats_client),
            jetstream_status,
        }
    }
}
