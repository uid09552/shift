use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::shift_wishes;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shift_wishes)]
pub struct ShiftWish {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub shift_id: Uuid,
    pub wish_date: NaiveDate,
    pub tenant_id: String,
    pub created_at: NaiveDateTime,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shift_wishes)]
pub struct NewShiftWish {
    pub employee_id: Uuid,
    pub shift_id: Uuid,
    pub wish_date: NaiveDate,
    pub tenant_id: String,
}
