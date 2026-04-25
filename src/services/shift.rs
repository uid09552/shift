use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde_json::Value;
use uuid::Uuid;

use crate::database::DbPool;
use crate::services::employee::PaginationQuery;

pub struct ShiftService;

impl ShiftService {
    pub async fn list_shifts(
        Query(_q): Query<PaginationQuery>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn create_shift(
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_shift_by_id(
        Path(_shift_id): Path<Uuid>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }
}