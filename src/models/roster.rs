use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::{roster_change_notices, roster_months};

#[derive(Queryable, Insertable, AsChangeset, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = roster_months)]
pub struct RosterMonth {
    pub tenant_id: String,
    pub month: NaiveDate,
    pub status: String,
    pub published_at: Option<NaiveDateTime>,
    pub published_by: Option<String>,
    pub locked_at: Option<NaiveDateTime>,
    pub locked_by: Option<String>,
    pub reopened: bool,
    pub updated_at: NaiveDateTime,
}

#[derive(Queryable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = roster_change_notices)]
pub struct RosterChangeNotice {
    pub id: Uuid,
    pub tenant_id: String,
    pub employee_id: Uuid,
    pub date: NaiveDate,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub source: String,
    pub actor: Option<String>,
    pub reason: Option<String>,
    pub created_at: NaiveDateTime,
    pub acknowledged_at: Option<NaiveDateTime>,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = roster_change_notices)]
pub struct NewRosterChangeNotice {
    pub tenant_id: String,
    pub employee_id: Uuid,
    pub date: NaiveDate,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub source: String,
    pub actor: Option<String>,
    pub reason: Option<String>,
}
