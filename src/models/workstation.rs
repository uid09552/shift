use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::workstations;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = workstations)]
pub struct Workstation {
    pub id: Uuid,
    pub name: String,
    pub available: bool,
    pub active_shift_ids: Vec<Uuid>,
    pub priority: String,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
    pub tenant_id: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = workstations)]
pub struct NewWorkstation<'a> {
    pub name: &'a str,
    pub available: bool,
    pub active_shift_ids: Vec<Uuid>,
    pub priority: &'a str,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
    pub tenant_id: &'a str,
}
