//! Open shifts and their volunteers (see migration 40).

use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;
use serde::Serialize;
use uuid::Uuid;

use crate::schema::{open_shift_volunteers, open_shifts};

#[derive(Queryable, Identifiable, Serialize, Debug, Clone)]
#[diesel(table_name = open_shifts)]
pub struct OpenShift {
    pub id: Uuid,
    #[serde(skip_serializing)]
    pub tenant_id: String,
    pub date: NaiveDate,
    pub shift_id: Uuid,
    pub workstation_id: Option<Uuid>,
    pub note: Option<String>,
    pub status: String,
    pub assigned_employee_id: Option<Uuid>,
    pub created_by: Option<String>,
    pub decided_by: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = open_shifts)]
pub struct NewOpenShift {
    pub tenant_id: String,
    pub date: NaiveDate,
    pub shift_id: Uuid,
    pub workstation_id: Option<Uuid>,
    pub note: Option<String>,
    pub created_by: Option<String>,
}

#[derive(Queryable, Insertable, Serialize, Debug, Clone)]
#[diesel(table_name = open_shift_volunteers)]
pub struct OpenShiftVolunteer {
    pub open_shift_id: Uuid,
    pub employee_id: Uuid,
    pub created_at: NaiveDateTime,
}
