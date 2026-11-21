//! Skill-mix and pairing rules (see migration 44 and planner/shift_planner/skill_mix.py).

use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::schema::{pairing_rules, skill_mix_rules};

#[derive(Queryable, Identifiable, Serialize, Debug, Clone)]
#[diesel(table_name = skill_mix_rules)]
pub struct SkillMixRule {
    pub id: Uuid,
    #[serde(skip_serializing)]
    pub tenant_id: String,
    pub kind: String,
    pub count: i32,
    pub capability_id: Option<Uuid>,
    pub skill_group: Option<String>,
    pub min_level: Option<i16>,
    pub shift_id: Option<Uuid>,
    pub workstation_id: Option<Uuid>,
    pub mode: String,
    pub created_at: NaiveDateTime,
}

#[derive(Insertable, Deserialize, Debug, Clone)]
#[diesel(table_name = skill_mix_rules)]
pub struct NewSkillMixRule {
    #[serde(skip)]
    pub tenant_id: String,
    pub kind: String,
    pub count: i32,
    pub capability_id: Option<Uuid>,
    pub skill_group: Option<String>,
    pub min_level: Option<i16>,
    pub shift_id: Option<Uuid>,
    pub workstation_id: Option<Uuid>,
    #[serde(default = "hard")]
    pub mode: String,
}

#[derive(Queryable, Identifiable, Serialize, Debug, Clone)]
#[diesel(table_name = pairing_rules)]
pub struct PairingRule {
    pub id: Uuid,
    #[serde(skip_serializing)]
    pub tenant_id: String,
    pub kind: String,
    pub employee_id: Uuid,
    pub partner_id: Uuid,
    pub mode: String,
    pub created_at: NaiveDateTime,
}

#[derive(Insertable, Deserialize, Debug, Clone)]
#[diesel(table_name = pairing_rules)]
pub struct NewPairingRule {
    #[serde(skip)]
    pub tenant_id: String,
    pub kind: String,
    pub employee_id: Uuid,
    pub partner_id: Uuid,
    #[serde(default = "hard")]
    pub mode: String,
}

fn hard() -> String {
    "hard".to_string()
}
