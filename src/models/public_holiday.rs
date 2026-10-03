use chrono::{NaiveDate, NaiveDateTime};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::public_holidays;

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
