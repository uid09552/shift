use axum::{
    extract::State,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::services::scheduling::SchedulingService;

#[derive(Deserialize)]
pub struct PlanRequest {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Serialize)]
pub struct PlanResponse {
    pub task_id: String,
}

pub struct PlannerService;

impl PlannerService {
    pub async fn trigger_plan(
        State(state): State<AppState>,
        Json(_body): Json<Value>,
    ) -> Result<Json<PlanResponse>, AppError> {
        // Send a scheduling request via NATS if broker is connected and use
        // the JetStream ack sequence as the task ID.
        let task_id = if let Some(nats_client) = &state.nats_client {
            let scheduling_service = SchedulingService::new(nats_client.clone(), state.jetstream_status);
            match scheduling_service.request_scheduling().await {
                Ok(ack_id) => ack_id,
                Err(e) => {
                    eprintln!("Failed to send scheduling request: {}", e);
                    return Err(AppError::Internal);
                }
            }
        } else {
            // Fallback when no broker is configured
            Uuid::new_v4().to_string()
        };

        Ok(Json(PlanResponse { task_id }))
    }
}
