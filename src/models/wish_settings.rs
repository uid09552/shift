use chrono::{NaiveDate, NaiveDateTime};
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
