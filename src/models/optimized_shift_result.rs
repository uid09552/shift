use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::optimized_shift_results;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = optimized_shift_results)]
pub struct OptimizedShiftResult {
    pub id: Uuid,
    pub result: serde_json::Value,
    pub creation_date: NaiveDateTime,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = optimized_shift_results)]
pub struct NewOptimizedShiftResult {
    pub result: serde_json::Value,
}
