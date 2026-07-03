use chrono::NaiveDate;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::workstation_unavailabilities;

#[derive(Queryable, Identifiable, Serialize, Deserialize, Debug)]
#[diesel(table_name = workstation_unavailabilities)]
pub struct WorkstationUnavailability {
    pub id: Uuid,
    pub workstation_id: Uuid,
    pub unavailable_from: NaiveDate,
    pub unavailable_to: NaiveDate,
}

#[derive(Insertable, Serialize, Deserialize, Debug)]
#[diesel(table_name = workstation_unavailabilities)]
pub struct NewWorkstationUnavailability {
    pub workstation_id: Uuid,
    pub unavailable_from: NaiveDate,
    pub unavailable_to: NaiveDate,
}
