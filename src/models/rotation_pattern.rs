use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::rotation_patterns;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = rotation_patterns)]
pub struct RotationPattern {
    pub id: Uuid,
    pub tenant_id: String,
    pub name: String,
    /// JSON array, one entry per day of the cycle: a shift id, or null for a day off.
    pub slots: serde_json::Value,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = rotation_patterns)]
pub struct NewRotationPattern {
    pub tenant_id: String,
    pub name: String,
    pub slots: serde_json::Value,
}
