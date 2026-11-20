use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::{holiday_syncs, public_holidays};

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = public_holidays)]
#[diesel(primary_key(tenant_id, holiday_date))]
pub struct PublicHoliday {
    pub tenant_id: String,
    pub holiday_date: NaiveDate,
    pub name: String,
    pub state: String,
    pub created_at: NaiveDateTime,
}

#[derive(Insertable, Debug, Clone)]
#[diesel(table_name = public_holidays)]
pub struct NewPublicHoliday {
    pub tenant_id: String,
    pub holiday_date: NaiveDate,
    pub name: String,
    pub state: String,
}

#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = holiday_syncs)]
pub struct HolidaySync {
    pub tenant_id: String,
    pub year: i32,
    pub state: String,
    pub last_synced_at: Option<NaiveDateTime>,
    pub last_attempt_at: NaiveDateTime,
    pub consecutive_failures: i32,
}
