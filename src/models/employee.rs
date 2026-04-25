use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::employees;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employees)]
pub struct Employee {
    pub id: Uuid,
    pub name: String,
    pub email: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = employees)]
pub struct NewEmployee<'a> {
    pub name: &'a str,
    pub email: &'a str,
}