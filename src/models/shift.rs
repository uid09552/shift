use chrono::NaiveTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::shifts;
use crate::schema::shift_weekday_times;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shifts)]
pub struct Shift {
    pub id: Uuid,
    pub name: String,
    pub short_name: String,
    pub color: String,
    pub order: i32,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shifts)]
pub struct NewShift<'a> {
    pub name: &'a str,
    pub short_name: &'a str,
    pub color: &'a str,
    pub order: i32,
}

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shift_weekday_times)]
pub struct ShiftWeekdayTime {
    pub id: Uuid,
    pub shift_id: Uuid,
    pub weekday: i16,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
    pub free_days_after_shift: i16,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shift_weekday_times)]
pub struct NewShiftWeekdayTime {
    pub shift_id: Uuid,
    pub weekday: i16,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub min_employees: i16,
    pub max_employees: Option<i16>,
    pub free_days_after_shift: i16,
}
