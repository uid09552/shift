use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::database::DbPool;

#[derive(Deserialize)]
pub struct ListWorkstationsQuery {
    pub available: Option<bool>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub struct WorkstationService;

impl WorkstationService {
    pub async fn list_workstations(
        Query(_q): Query<ListWorkstationsQuery>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn create_workstation(
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_workstation_by_id(
        Path(_workstation_id): Path<Uuid>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn update_workstation(
        Path(_workstation_id): Path<Uuid>,
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn set_workstation_availability(
        Path(_workstation_id): Path<Uuid>,
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_workstation_required_capabilities(
        Path(_workstation_id): Path<Uuid>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn add_workstation_required_capability(
        Path(_workstation_id): Path<Uuid>,
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }
}