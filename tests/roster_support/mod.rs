//! A test tenant for the roster lifecycle suites (`roster_months.rs`,
//! `roster_lifecycle.rs`): two employees, two shifts, a server that trusts
//! signed tokens, and helpers to set month statuses and read notices straight
//! from the database. Needs PostgreSQL (`DATABASE_URL`, or the development
//! default); `spawn` returns `None` without one and the tests pass with a notice.
#![allow(dead_code)]

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Datelike, Local, NaiveDate};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::TestKeys;
use shift::database::DbPool;
use shift::models::{NewConfirmedShiftPlan, NewEmployee, NewShift};
use shift::repository::AppState;
use shift::schema::{
    audit_logs, confirmed_shift_plans, employees, planner_settings, roster_change_notices, roster_months,
    shift_swap_requests, shifts, unavailabilities,
};

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

pub struct Person {
    pub id: Uuid,
    pub email: String,
}

pub struct TestApp {
    pub base_url: String,
    pub tenant: String,
    pub keys: TestKeys,
    pub anna: Person,
    pub ben: Person,
    pub early: Uuid,
    pub late: Uuid,
    pub pool: DbPool,
}

/// `offset` days from today.
pub fn day(offset: i64) -> NaiveDate {
    Local::now().date_naive() + chrono::Duration::days(offset)
}

pub fn first_of(date: NaiveDate) -> NaiveDate {
    date.with_day(1).unwrap()
}

/// `YYYY-MM` of `date`.
pub fn ym(date: NaiveDate) -> String {
    format!("{:04}-{:02}", date.year(), date.month())
}

impl TestApp {
    pub async fn spawn(label: &str) -> Option<Self> {
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(ConnectionManager::<PgConnection>::new(url))
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping {label} tests: no database ({e})");
                return None;
            }
        };
        shift::database::run_migrations(&pool).expect("migrations");

        let tenant = format!("test-{label}-{}", Uuid::new_v4());
        let mut conn = pool.get().expect("connection");
        let mut person = |name: &str| {
            let email = format!("{}-{}@test.invalid", name.to_lowercase(), Uuid::new_v4());
            let id = diesel::insert_into(employees::table)
                .values(NewEmployee { name, email: &email, weekly_working_hours: Some(40.0), tenant_id: &tenant })
                .returning(employees::id)
                .get_result(&mut conn)
                .expect("insert employee");
            Person { id, email }
        };
        let (anna, ben) = (person("Anna"), person("Ben"));
        let mut shift = |name: &str, order: i32| -> Uuid {
            diesel::insert_into(shifts::table)
                .values(NewShift { name, short_name: &name[..1], color: "#22C55E", order, tenant_id: &tenant })
                .returning(shifts::id)
                .get_result(&mut conn)
                .expect("insert shift")
        };
        let (early, late) = (shift("Early", 1), shift("Late", 2));
        drop(conn);

        let keys = TestKeys::serve().await;
        let mut state = AppState::new(Arc::new(pool.clone()));
        state.token_verifier = Some(keys.verifier());
        let app = shift::server::create_router(state);
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        Some(Self {
            base_url: format!("http://{addr}/api/v1"),
            tenant,
            keys,
            anna,
            ben,
            early,
            late,
            pool,
        })
    }

    pub fn token(&self, roles: &[&str], email: &str) -> String {
        self.keys.sign(json!({
            "sub": email,
            "tenant": [self.tenant],
            "realm_access": { "roles": roles },
            "email": email,
            "preferred_username": email,
        }))
    }

    pub fn viewer(&self, who: &Person) -> String {
        self.token(&["shift-viewer"], &who.email)
    }

    pub fn planner(&self) -> String {
        self.token(&["shift-planner"], "planner@test.invalid")
    }

    pub fn admin(&self) -> String {
        self.token(&["shift-admin"], "admin@test.invalid")
    }

    /// `(status, body)`; `reason` goes out as `X-Change-Reason`, URL-encoded.
    pub async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        token: &str,
        body: Option<Value>,
        reason: Option<&str>,
    ) -> (u16, Value) {
        let mut request = reqwest::Client::new()
            .request(method, format!("{}{}", self.base_url, path))
            .header("x-access-token", token);
        if let Some(reason) = reason {
            request = request.header("x-change-reason", urlencode(reason));
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    pub async fn get(&self, path: &str, token: &str) -> (u16, Value) {
        self.call(reqwest::Method::GET, path, token, None, None).await
    }

    pub async fn post(&self, path: &str, token: &str, body: Option<Value>, reason: Option<&str>) -> (u16, Value) {
        self.call(reqwest::Method::POST, path, token, body, reason).await
    }

    pub async fn put(&self, path: &str, token: &str, body: Value, reason: Option<&str>) -> (u16, Value) {
        self.call(reqwest::Method::PUT, path, token, Some(body), reason).await
    }

    pub async fn delete(&self, path: &str, token: &str, reason: Option<&str>) -> (u16, Value) {
        self.call(reqwest::Method::DELETE, path, token, None, reason).await
    }

    /// Stores `status` for the month containing `date`, bypassing the API.
    pub fn set_month(&self, date: NaiveDate, status: &str) {
        let mut conn = self.pool.get().expect("connection");
        diesel::insert_into(roster_months::table)
            .values((
                roster_months::tenant_id.eq(&self.tenant),
                roster_months::month.eq(first_of(date)),
                roster_months::status.eq(status),
            ))
            .on_conflict((roster_months::tenant_id, roster_months::month))
            .do_update()
            .set(roster_months::status.eq(status))
            .execute(&mut conn)
            .expect("set month status");
    }

    /// A roster row: `shift` on `date`, or a free day.
    pub fn roster(&self, employee: Uuid, date: NaiveDate, shift: Option<Uuid>) -> Uuid {
        let mut conn = self.pool.get().expect("connection");
        diesel::insert_into(confirmed_shift_plans::table)
            .values(NewConfirmedShiftPlan {
                employee_id: employee,
                shift_id: shift,
                workstation_id: None,
                date,
                is_present: shift.is_some(),
                absence_type: if shift.is_some() { None } else { Some("free".into()) },
                creation_type: "automated".into(),
                tenant_id: self.tenant.clone(),
            })
            .returning(confirmed_shift_plans::id)
            .get_result(&mut conn)
            .expect("insert roster row")
    }

    /// The shift `employee` has on `date`: `Some(shift)`, `Some(None)` for a
    /// row without a shift, `None` for no row.
    pub fn roster_cell(&self, employee: Uuid, date: NaiveDate) -> Option<Option<Uuid>> {
        let mut conn = self.pool.get().expect("connection");
        confirmed_shift_plans::table
            .filter(confirmed_shift_plans::tenant_id.eq(&self.tenant))
            .filter(confirmed_shift_plans::employee_id.eq(employee))
            .filter(confirmed_shift_plans::date.eq(date))
            .select(confirmed_shift_plans::shift_id)
            .first(&mut conn)
            .optional()
            .expect("read roster")
    }

    /// `(employee_id, date, source, reason, before shift, after shift)` of every notice, oldest first.
    pub fn notices(&self) -> Vec<(Uuid, NaiveDate, String, Option<String>, Option<Value>, Option<Value>)> {
        let mut conn = self.pool.get().expect("connection");
        roster_change_notices::table
            .filter(roster_change_notices::tenant_id.eq(&self.tenant))
            .order((roster_change_notices::created_at.asc(), roster_change_notices::date.asc()))
            .select((
                roster_change_notices::employee_id,
                roster_change_notices::date,
                roster_change_notices::source,
                roster_change_notices::reason,
                roster_change_notices::before,
                roster_change_notices::after,
            ))
            .load(&mut conn)
            .expect("read notices")
    }

    pub fn cleanup(&self) {
        let mut conn = self.pool.get().expect("connection");
        let t = &self.tenant;
        let _ = diesel::delete(roster_change_notices::table.filter(roster_change_notices::tenant_id.eq(t))).execute(&mut conn);
        let _ = diesel::delete(roster_months::table.filter(roster_months::tenant_id.eq(t))).execute(&mut conn);
        let _ = diesel::delete(shift_swap_requests::table.filter(shift_swap_requests::tenant_id.eq(t))).execute(&mut conn);
        let _ = diesel::delete(confirmed_shift_plans::table.filter(confirmed_shift_plans::tenant_id.eq(t))).execute(&mut conn);
        let _ = diesel::delete(unavailabilities::table.filter(unavailabilities::tenant_id.eq(t))).execute(&mut conn);
        let _ = diesel::delete(employees::table.filter(employees::tenant_id.eq(t))).execute(&mut conn);
        let _ = diesel::delete(shifts::table.filter(shifts::tenant_id.eq(t))).execute(&mut conn);
        let _ = diesel::delete(planner_settings::table.filter(planner_settings::tenant_id.eq(t))).execute(&mut conn);
        let _ = diesel::delete(audit_logs::table.filter(audit_logs::tenant_id.eq(t))).execute(&mut conn);
    }
}

fn urlencode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
