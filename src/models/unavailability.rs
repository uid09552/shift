use chrono::NaiveDate;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::unavailabilities;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = unavailabilities)]
pub struct Unavailability {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub unavailable_date: NaiveDate,
    pub shift_id: Option<Uuid>,
    pub tenant_id: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = unavailabilities)]
pub struct NewUnavailability {
    pub employee_id: Uuid,
    pub unavailable_date: NaiveDate,
    pub shift_id: Option<Uuid>,
    pub tenant_id: String,
}