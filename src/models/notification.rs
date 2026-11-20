//! E-mail notification preferences and the outbox (see migration 39).

use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::Serialize;
use uuid::Uuid;

use crate::schema::{notification_outbox, notification_preferences};

#[derive(Queryable, Insertable, AsChangeset, Debug, Clone)]
#[diesel(table_name = notification_preferences)]
pub struct NotificationPreference {
    pub employee_id: Uuid,
    pub tenant_id: String,
    pub email_enabled: bool,
    pub muted_events: Vec<String>,
    pub updated_at: NaiveDateTime,
}

#[derive(Queryable, Identifiable, Serialize, Debug, Clone)]
#[diesel(table_name = notification_outbox)]
pub struct OutboxMessage {
    pub id: Uuid,
    pub tenant_id: String,
    pub employee_id: Option<Uuid>,
    pub recipient: String,
    pub event: String,
    pub subject: String,
    pub body: String,
    pub status: String,
    pub attempts: i32,
    pub next_attempt_at: NaiveDateTime,
    pub last_error: Option<String>,
    pub created_at: NaiveDateTime,
    pub sent_at: Option<NaiveDateTime>,
}

#[derive(Insertable, Debug, Clone)]
#[diesel(table_name = notification_outbox)]
pub struct NewOutboxMessage {
    pub tenant_id: String,
    pub employee_id: Option<Uuid>,
    pub recipient: String,
    pub event: String,
    pub subject: String,
    pub body: String,
}
