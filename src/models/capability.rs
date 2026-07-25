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
    // Ordinal skill level (1 = base). Capabilities sharing a `skill_group`
    // are treated as substitutable tiers of the same skill by the optimizer's
    // skill-downgrade objective; unused for tenants that don't set skill_group.
    pub level: i16,
    pub skill_group: Option<String>,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = capabilities)]
pub struct NewCapability<'a> {
    pub name: &'a str,
    pub tenant_id: &'a str,
    pub level: i16,
    pub skill_group: Option<&'a str>,
}
