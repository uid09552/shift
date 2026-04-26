use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::repository::AppState;
use crate::repository::domain::EmployeeRepository;

#[derive(Deserialize)]
pub struct PaginationQuery {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[derive(Deserialize)]
pub struct AddCapabilityRequest {
    pub capability_id: Uuid,
}

pub struct EmployeeService;

impl EmployeeService {
    pub async fn list_employees(
        Query(_q): Query<PaginationQuery>,
        State(_state): State<AppState>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn create_employee(
        State(_state): State<AppState>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_employee_by_id(
        Path(_employee_id): Path<Uuid>,
        State(_state): State<AppState>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn update_employee(
        Path(_employee_id): Path<Uuid>,
        State(_state): State<AppState>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_employee_by_email(
        Path(_email): Path<String>,
        State(_state): State<AppState>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_employee_capabilities(
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Json<Value> {
        let capabilities = state
            .employee_repo
            .get_employee_capabilities(employee_id)
            .await
            .expect("Error loading employee capabilities");

        Json(serde_json::to_value(capabilities).unwrap())
    }

    pub async fn add_employee_capability(
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<AddCapabilityRequest>,
    ) -> Json<Value> {
        state
            .employee_repo
            .add_employee_capability(employee_id, body.capability_id)
            .await
            .expect("Error inserting employee capability");

        Json(serde_json::json!({ "message": "Capability added successfully" }))
    }

    pub async fn get_employee_available_shifts(
        Path(_employee_id): Path<Uuid>,
        State(_state): State<AppState>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn add_employee_available_shift(
        Path(_employee_id): Path<Uuid>,
        State(_state): State<AppState>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }
}