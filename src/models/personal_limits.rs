use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::employee_personal_limits;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = employee_personal_limits)]
#[diesel(primary_key(employee_id))]
pub struct PersonalLimits {
    pub employee_id: Uuid,
    pub tenant_id: String,
    pub max_nights_per_month: Option<i16>,
    pub max_weekends_per_month: Option<i16>,
    pub no_night_shifts: bool,
    pub preferred_days_off: Vec<i16>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// `treat_none_as_null` so removing a limit actually removes it (see
/// `NewWishSettings` for the same reason).
#[derive(Insertable, AsChangeset, Debug, Clone)]
#[diesel(table_name = employee_personal_limits, treat_none_as_null = true)]
pub struct NewPersonalLimits {
    pub employee_id: Uuid,
    pub tenant_id: String,
    pub max_nights_per_month: Option<i16>,
    pub max_weekends_per_month: Option<i16>,
    pub no_night_shifts: bool,
    pub preferred_days_off: Vec<i16>,
}
