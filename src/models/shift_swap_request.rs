use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::shift_swap_requests;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shift_swap_requests)]
pub struct ShiftSwapRequest {
    pub id: Uuid,
    pub tenant_id: String,
    pub requester_id: Uuid,
    pub requester_date: NaiveDate,
    pub requester_shift_id: Uuid,
    pub requester_workstation_id: Option<Uuid>,
    pub colleague_id: Uuid,
    pub colleague_date: NaiveDate,
    pub colleague_shift_id: Uuid,
    pub colleague_workstation_id: Option<Uuid>,
    pub status: String,
    pub decided_by: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shift_swap_requests)]
pub struct NewShiftSwapRequest {
    pub tenant_id: String,
    pub requester_id: Uuid,
    pub requester_date: NaiveDate,
    pub requester_shift_id: Uuid,
    pub requester_workstation_id: Option<Uuid>,
    pub colleague_id: Uuid,
    pub colleague_date: NaiveDate,
    pub colleague_shift_id: Uuid,
    pub colleague_workstation_id: Option<Uuid>,
}
