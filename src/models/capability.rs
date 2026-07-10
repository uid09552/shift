use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::capabilities;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = capabilities)]
pub struct Capability {
    pub id: Uuid,
    pub name: String,
    pub tenant_id: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = capabilities)]
pub struct NewCapability<'a> {
    pub name: &'a str,
    pub tenant_id: &'a str,
}