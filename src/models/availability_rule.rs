//! Recurring availability per employee (see migration 46 and services::availability).

use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::availability_rules;

#[derive(Queryable, Identifiable, Serialize, Debug, Clone)]
#[diesel(table_name = availability_rules)]
pub struct AvailabilityRule {
    pub id: Uuid,
    #[serde(skip_serializing)]
    pub tenant_id: String,
    pub employee_id: Uuid,
    pub kind: String,
    pub shift_ids: Vec<Uuid>,
    pub weekdays: Vec<i16>,
    pub mode: String,
    pub valid_from: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub note: Option<String>,
    pub created_at: NaiveDateTime,
}

#[derive(Insertable, Deserialize, Debug, Clone)]
#[diesel(table_name = availability_rules)]
pub struct NewAvailabilityRule {
    #[serde(skip)]
    pub tenant_id: String,
    #[serde(skip)]
    pub employee_id: Uuid,
    pub kind: String,
    #[serde(default)]
    pub shift_ids: Vec<Uuid>,
    #[serde(default)]
    pub weekdays: Vec<i16>,
    #[serde(default = "hard")]
    pub mode: String,
    pub valid_from: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub note: Option<String>,
}

fn hard() -> String {
    "hard".to_string()
}
