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
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shifts)]
pub struct NewShift<'a> {
    pub name: &'a str,
}

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shift_weekday_times)]
pub struct ShiftWeekdayTime {
    pub id: Uuid,
    pub shift_id: Uuid,
    pub weekday: i16,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = shift_weekday_times)]
pub struct NewShiftWeekdayTime {
    pub shift_id: Uuid,
    pub weekday: i16,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
}
