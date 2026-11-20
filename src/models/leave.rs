//! Leave requests, blackout periods and absence limits (see migration 38).

use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::{leave_blackouts, leave_limits, leave_requests};

#[derive(Queryable, Identifiable, Serialize, Debug, Clone)]
#[diesel(table_name = leave_requests)]
pub struct LeaveRequest {
    pub id: Uuid,
    #[serde(skip_serializing)]
    pub tenant_id: String,
    pub employee_id: Uuid,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub note: Option<String>,
    pub status: String,
    pub decided_by: Option<String>,
    pub decision_comment: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = leave_requests)]
pub struct NewLeaveRequest {
    pub tenant_id: String,
    pub employee_id: Uuid,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub note: Option<String>,
}

#[derive(Queryable, Identifiable, Serialize, Debug, Clone)]
#[diesel(table_name = leave_blackouts)]
pub struct LeaveBlackout {
    pub id: Uuid,
    #[serde(skip_serializing)]
    pub tenant_id: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub reason: Option<String>,
    pub created_at: NaiveDateTime,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = leave_blackouts)]
pub struct NewLeaveBlackout {
    pub tenant_id: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub reason: Option<String>,
}

#[derive(Queryable, Insertable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = leave_limits)]
pub struct LeaveLimit {
    #[serde(skip)]
    pub tenant_id: String,
    pub capability_id: Uuid,
    pub max_absent: i32,
}
