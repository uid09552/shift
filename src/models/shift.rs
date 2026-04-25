use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::shifts;

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