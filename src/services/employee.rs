use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::database::DbPool;

#[derive(Deserialize)]
pub struct PaginationQuery {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub struct EmployeeService;

impl EmployeeService {
    pub async fn list_employees(
        Query(_q): Query<PaginationQuery>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn create_employee(
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_employee_by_id(
        Path(_employee_id): Path<Uuid>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn update_employee(
        Path(_employee_id): Path<Uuid>,
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_employee_by_email(
        Path(_email): Path<String>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_employee_capabilities(
        Path(_employee_id): Path<Uuid>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn add_employee_capability(
        Path(_employee_id): Path<Uuid>,
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn get_employee_available_shifts(
        Path(_employee_id): Path<Uuid>,
        State(_pool): State<DbPool>,
    ) -> Json<Value> {
        todo!()
    }

    pub async fn add_employee_available_shift(
        Path(_employee_id): Path<Uuid>,
        State(_pool): State<DbPool>,
        Json(_body): Json<Value>,
    ) -> Json<Value> {
        todo!()
    }
}