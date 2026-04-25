use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::workstation_required_capabilities;

#[derive(Queryable, Serialize, Deserialize, Debug)]
#[diesel(table_name = workstation_required_capabilities)]
pub struct WorkstationRequiredCapability {
    pub workstation_id: Uuid,
    pub capability_id: Uuid,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = workstation_required_capabilities)]
pub struct NewWorkstationRequiredCapability {
    pub workstation_id: Uuid,
    pub capability_id: Uuid,
}