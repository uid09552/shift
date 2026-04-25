use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde_json::Value;
use uuid::Uuid;

use crate::database::DbPool;
use crate::services::employee::PaginationQuery;

pub struct CapabilityService;

impl CapabilityService {
    pub async fn list_capabilities(
        Query(_q): Query<PaginationQuery>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn create_capability(
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_capability_by_id(
        Path(_capability_id): Path<Uuid>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }
}