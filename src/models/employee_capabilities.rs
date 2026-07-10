use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::employee_capabilities;

#[derive(Queryable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employee_capabilities)]
pub struct EmployeeCapability {
    pub employee_id: Uuid,
    pub capability_id: Uuid,
    pub tenant_id: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employee_capabilities)]
pub struct NewEmployeeCapability {
    pub employee_id: Uuid,
    pub capability_id: Uuid,
    pub tenant_id: String,
}