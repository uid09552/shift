pub mod domain;
pub mod employeerepository;
pub mod shiftrepository;
pub mod shiftassignmentrepository;
pub mod confirmedshiftplanrepository;
pub mod optimizedshiftresultrepository;

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
use self::shiftassignmentrepository::DieselEmployeeShiftAssignmentRepository;
use self::confirmedshiftplanrepository::DieselConfirmedShiftPlanRepository;
use self::optimizedshiftresultrepository::DieselOptimizedShiftResultRepository;

#[derive(Clone)]
pub struct AppState {
    pub employee_repo: DieselEmployeeRepository,
    pub shift_repo: DieselShiftRepository,
    pub capability_repo: DieselCapabilityRepository,
    pub workstation_repo: DieselWorkstationRepository,
    pub unavailability_repo: DieselUnavailabilityRepository,
    pub shift_assignment_repo: DieselEmployeeShiftAssignmentRepository,
    pub confirmed_shift_plan_repo: DieselConfirmedShiftPlanRepository,
    pub optimized_shift_result_repo: DieselOptimizedShiftResultRepository,
    pub pool: Arc<DbPool>,
    pub nats_client: Option<async_nats::Client>,
    pub jetstream_status: JetStreamStatus,
    pub optimizer_url: String,
}

impl AppState {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self {
            employee_repo: DieselEmployeeRepository { pool: Arc::clone(&pool) },
            shift_repo: DieselShiftRepository { pool: Arc::clone(&pool) },
            capability_repo: DieselCapabilityRepository { pool: Arc::clone(&pool) },
            workstation_repo: DieselWorkstationRepository { pool: Arc::clone(&pool) },
            unavailability_repo: DieselUnavailabilityRepository { pool: Arc::clone(&pool) },
            shift_assignment_repo: DieselEmployeeShiftAssignmentRepository { pool: Arc::clone(&pool) },
            confirmed_shift_plan_repo: DieselConfirmedShiftPlanRepository { pool: Arc::clone(&pool) },
            optimized_shift_result_repo: DieselOptimizedShiftResultRepository { pool: Arc::clone(&pool) },
            pool: pool,
            nats_client: None,
            jetstream_status: JetStreamStatus::Unavailable,
            optimizer_url: "http://localhost:8888".to_string(),
        }
    }

    pub fn with_nats(pool: Arc<DbPool>, nats_client: async_nats::Client, jetstream_status: JetStreamStatus, optimizer_url: String) -> Self {
        Self {
            employee_repo: DieselEmployeeRepository { pool: Arc::clone(&pool) },
            shift_repo: DieselShiftRepository { pool: Arc::clone(&pool) },
            capability_repo: DieselCapabilityRepository { pool: Arc::clone(&pool) },
            workstation_repo: DieselWorkstationRepository { pool: Arc::clone(&pool) },
            unavailability_repo: DieselUnavailabilityRepository { pool: Arc::clone(&pool) },
            shift_assignment_repo: DieselEmployeeShiftAssignmentRepository { pool: Arc::clone(&pool) },
            confirmed_shift_plan_repo: DieselConfirmedShiftPlanRepository { pool: Arc::clone(&pool) },
            optimized_shift_result_repo: DieselOptimizedShiftResultRepository { pool: Arc::clone(&pool) },
            pool,
            nats_client: Some(nats_client),
            jetstream_status,
            optimizer_url,
        }
    }
}
