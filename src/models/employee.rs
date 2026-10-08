use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::employees;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employees)]
pub struct Employee {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub tenant_id: String,
    /// Own contracted hours per week; `None` follows the tenant default.
    pub weekly_working_hours: Option<f64>,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employees)]
pub struct NewEmployee<'a> {
    pub name: &'a str,
    pub email: &'a str,
    pub weekly_working_hours: Option<f64>,
    pub tenant_id: &'a str,
}