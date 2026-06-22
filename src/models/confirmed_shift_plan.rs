use chrono::NaiveDate;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::confirmed_shift_plans;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = confirmed_shift_plans)]
pub struct ConfirmedShiftPlan {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub shift_id: Option<Uuid>,
    pub workstation_id: Option<Uuid>,
    pub date: NaiveDate,
    pub is_present: bool,
    pub absence_type: Option<String>,
    pub creation_type: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = confirmed_shift_plans)]
pub struct NewConfirmedShiftPlan {
    pub employee_id: Uuid,
    pub shift_id: Option<Uuid>,
    pub workstation_id: Option<Uuid>,
    pub date: NaiveDate,
    pub is_present: bool,
    pub absence_type: Option<String>,
    pub creation_type: String,
}

#[derive(AsChangeset, Serialize, Deserialize, Debug)]
#[diesel(table_name = confirmed_shift_plans)]
pub struct UpdateConfirmedShiftPlan {
    pub shift_id: Option<Option<Uuid>>,
    pub workstation_id: Option<Option<Uuid>>,
    pub is_present: Option<bool>,
    pub absence_type: Option<String>,
    pub creation_type: Option<String>,
    pub updated_at: NaiveDateTime,
}
