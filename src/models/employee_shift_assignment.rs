use chrono::NaiveDate;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::employee_shift_assignments;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employee_shift_assignments)]
pub struct EmployeeShiftAssignment {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub shift_id: Uuid,
    pub date: NaiveDate,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employee_shift_assignments)]
pub struct NewEmployeeShiftAssignment {
    pub employee_id: Uuid,
    pub shift_id: Uuid,
    pub date: NaiveDate,
}
