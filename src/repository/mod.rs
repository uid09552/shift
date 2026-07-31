pub mod domain;
pub mod employeerepository;
pub mod shiftrepository;
pub mod shiftwishrepository;
pub mod shiftassignmentrepository;
pub mod confirmedshiftplanrepository;
pub mod optimizedshiftresultrepository;
pub mod planningtaskrepository;
pub mod analysisrepository;
pub mod auditlogrepository;
pub mod plannersettingsrepository;

use std::sync::Arc;
use crate::database::DbPool;
use crate::broker::JetStreamStatus;
use self::employeerepository::{
    DieselCapabilityRepository,
    DieselEmployeeRepository,
    DieselUnavailabilityRepository,
    DieselWorkstationRepository,
    DieselWorkstationUnavailabilityRepository,
};
use self::shiftrepository::DieselShiftRepository;
use self::shiftwishrepository::DieselShiftWishRepository;
use self::shiftassignmentrepository::DieselEmployeeShiftAssignmentRepository;
use self::confirmedshiftplanrepository::DieselConfirmedShiftPlanRepository;
use self::optimizedshiftresultrepository::DieselOptimizedShiftResultRepository;
use self::planningtaskrepository::DieselPlanningTaskRepository;
use self::analysisrepository::DieselAnalysisRepository;
use self::auditlogrepository::DieselAuditLogRepository;
use self::plannersettingsrepository::DieselPlannerSettingsRepository;

#[derive(Clone)]
pub struct AppState {
    pub employee_repo: DieselEmployeeRepository,
    pub shift_repo: DieselShiftRepository,
    pub capability_repo: DieselCapabilityRepository,
    pub workstation_repo: DieselWorkstationRepository,
    pub unavailability_repo: DieselUnavailabilityRepository,
    pub shift_wish_repo: DieselShiftWishRepository,
    pub workstation_unavailability_repo: DieselWorkstationUnavailabilityRepository,
    pub shift_assignment_repo: DieselEmployeeShiftAssignmentRepository,
    pub confirmed_shift_plan_repo: DieselConfirmedShiftPlanRepository,
    pub optimized_shift_result_repo: DieselOptimizedShiftResultRepository,
    pub planning_task_repo: DieselPlanningTaskRepository,
    pub analysis_repo: DieselAnalysisRepository,
    pub audit_log_repo: DieselAuditLogRepository,
    pub planner_settings_repo: DieselPlannerSettingsRepository,
    pub pool: Arc<DbPool>,
    pub nats_client: Option<async_nats::Client>,
    pub jetstream_status: JetStreamStatus,
    pub optimizer_url: String,
    pub dev_mode: bool,
    pub default_tenant_id: String,
}

impl AppState {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self {
            employee_repo: DieselEmployeeRepository { pool: Arc::clone(&pool) },
            shift_repo: DieselShiftRepository { pool: Arc::clone(&pool) },
            capability_repo: DieselCapabilityRepository { pool: Arc::clone(&pool) },
            workstation_repo: DieselWorkstationRepository { pool: Arc::clone(&pool) },
            unavailability_repo: DieselUnavailabilityRepository { pool: Arc::clone(&pool) },
            shift_wish_repo: DieselShiftWishRepository { pool: Arc::clone(&pool) },
            workstation_unavailability_repo: DieselWorkstationUnavailabilityRepository { pool: Arc::clone(&pool) },
            shift_assignment_repo: DieselEmployeeShiftAssignmentRepository { pool: Arc::clone(&pool) },
            confirmed_shift_plan_repo: DieselConfirmedShiftPlanRepository { pool: Arc::clone(&pool) },
            optimized_shift_result_repo: DieselOptimizedShiftResultRepository { pool: Arc::clone(&pool) },
            planning_task_repo: DieselPlanningTaskRepository { pool: Arc::clone(&pool) },
            analysis_repo: DieselAnalysisRepository { pool: Arc::clone(&pool) },
            audit_log_repo: DieselAuditLogRepository { pool: Arc::clone(&pool) },
            planner_settings_repo: DieselPlannerSettingsRepository { pool: Arc::clone(&pool) },
            pool,
            nats_client: None,
            jetstream_status: JetStreamStatus::Unavailable,
            optimizer_url: "http://localhost:8888".to_string(),
            dev_mode: false,
            default_tenant_id: "0".to_string(),
        }
    }

    pub fn with_nats(pool: Arc<DbPool>, nats_client: async_nats::Client, jetstream_status: JetStreamStatus, optimizer_url: String) -> Self {
        Self {
            employee_repo: DieselEmployeeRepository { pool: Arc::clone(&pool) },
            shift_repo: DieselShiftRepository { pool: Arc::clone(&pool) },
            capability_repo: DieselCapabilityRepository { pool: Arc::clone(&pool) },
            workstation_repo: DieselWorkstationRepository { pool: Arc::clone(&pool) },
            unavailability_repo: DieselUnavailabilityRepository { pool: Arc::clone(&pool) },
            shift_wish_repo: DieselShiftWishRepository { pool: Arc::clone(&pool) },
            workstation_unavailability_repo: DieselWorkstationUnavailabilityRepository { pool: Arc::clone(&pool) },
            shift_assignment_repo: DieselEmployeeShiftAssignmentRepository { pool: Arc::clone(&pool) },
            confirmed_shift_plan_repo: DieselConfirmedShiftPlanRepository { pool: Arc::clone(&pool) },
            optimized_shift_result_repo: DieselOptimizedShiftResultRepository { pool: Arc::clone(&pool) },
            planning_task_repo: DieselPlanningTaskRepository { pool: Arc::clone(&pool) },
            analysis_repo: DieselAnalysisRepository { pool: Arc::clone(&pool) },
            audit_log_repo: DieselAuditLogRepository { pool: Arc::clone(&pool) },
            planner_settings_repo: DieselPlannerSettingsRepository { pool: Arc::clone(&pool) },
            pool,
            nats_client: Some(nats_client),
            jetstream_status,
            optimizer_url,
            dev_mode: false,
            default_tenant_id: "0".to_string(),
        }
    }
}
