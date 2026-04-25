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
    pub active_shift_id: Option<Uuid>,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = workstations)]
pub struct NewWorkstation<'a> {
    pub name: &'a str,
    pub available: bool,
    pub active_shift_id: Option<Uuid>,
}