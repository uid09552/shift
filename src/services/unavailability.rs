use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::repository::AppState;

#[derive(Deserialize)]
pub struct ListUnavailabilitiesQuery {
    pub employee_id: Option<Uuid>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub struct UnavailabilityService;

impl UnavailabilityService {
    pub async fn list_unavailabilities(
        Query(_q): Query<ListUnavailabilitiesQuery>,
        State(_state): State<AppState>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn create_unavailability(
        State(_state): State<AppState>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_unavailability_by_id(
        Path(_unavailability_id): Path<Uuid>,
        State(_state): State<AppState>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn delete_unavailability(
        Path(_unavailability_id): Path<Uuid>,
        State(_state): State<AppState>,
    ) -> Json<Value> {
        todo!()
    }
}