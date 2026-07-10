use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::planning_tasks;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = planning_tasks)]
pub struct PlanningTask {
    pub id: Uuid,
    pub status: String,
    pub payload: serde_json::Value,
    pub result_id: Option<Uuid>,
    pub error_message: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
    pub tenant_id: String,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = planning_tasks)]
pub struct NewPlanningTask {
    pub id: Uuid,
    pub status: String,
    pub payload: serde_json::Value,
    pub tenant_id: String,
}
