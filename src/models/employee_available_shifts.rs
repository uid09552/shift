use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::employee_available_shifts;

#[derive(Queryable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employee_available_shifts)]
pub struct EmployeeAvailableShift {
    pub employee_id: Uuid,
    pub shift_id: Uuid,
    pub tenant_id: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employee_available_shifts)]
pub struct NewEmployeeAvailableShift {
    pub employee_id: Uuid,
    pub shift_id: Uuid,
    pub tenant_id: String,
}