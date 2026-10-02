use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::wish_settings;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = wish_settings)]
#[diesel(primary_key(tenant_id))]
pub struct WishSettings {
    pub tenant_id: String,
    pub mode: String,
    pub window_start: Option<NaiveDate>,
    pub window_end: Option<NaiveDate>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub schedule_enabled: bool,
    pub schedule_unit: String,
    pub schedule_interval: i32,
    pub schedule_weekday: i16,
    pub schedule_day_of_month: i16,
    pub schedule_time: NaiveTime,
    pub schedule_open_days: i32,
    pub schedule_start_date: Option<NaiveDate>,
    pub schedule_applied_open: Option<bool>,
}

/// The schedule columns alone. `treat_none_as_null` so an unset start date clears.
/// Saving resets `schedule_applied_open`, so the job applies the new schedule.
#[derive(AsChangeset, Debug, Clone)]
#[diesel(table_name = wish_settings, treat_none_as_null = true)]
pub struct WishScheduleChangeset {
    pub schedule_enabled: bool,
    pub schedule_unit: String,
    pub schedule_interval: i32,
    pub schedule_weekday: i16,
    pub schedule_day_of_month: i16,
    pub schedule_time: NaiveTime,
    pub schedule_open_days: i32,
    pub schedule_start_date: Option<NaiveDate>,
    pub schedule_applied_open: Option<bool>,
}

/// `treat_none_as_null` so clearing the window actually clears it: without it
/// Diesel's `AsChangeset` skips `None` fields, and the old dates would silently
/// survive an update meant to drop them.
#[derive(Insertable, AsChangeset, Debug, Clone)]
#[diesel(table_name = wish_settings, treat_none_as_null = true)]
pub struct NewWishSettings {
    pub tenant_id: String,
    pub mode: String,
    pub window_start: Option<NaiveDate>,
    pub window_end: Option<NaiveDate>,
}

impl NewWishSettings {
    /// Wishing is open by default — the behaviour before the window existed.
    pub fn defaults(tenant_id: &str) -> Self {
        Self {
            tenant_id: tenant_id.to_string(),
            mode: "enabled".to_string(),
            window_start: None,
            window_end: None,
        }
    }
}
