//! Deleting a shift, an employee or a workstation and the roster lifecycle.
//!
//! Every roster write goes through the roster guard. Deleting master data used
//! to bypass it: the foreign keys from `confirmed_shift_plans` cascaded, so
//! deleting a shift or a person silently removed their entries from published
//! and locked months (and a workstation's were detached). Now such a delete is
//! refused with 409 while a published or locked month uses the item; entries in
//! draft months are removed (or detached) with it, in one transaction.
//!
//! Needs PostgreSQL; point `DATABASE_URL` at it, or leave it unset to use the
//! development default. With no database the tests print a notice and pass,
//! like the other integration tests.

mod common;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::sql_types::BigInt;
use serde_json::{json, Value};
use uuid::Uuid;

use common::TestKeys;
use shift::database::DbPool;
use shift::repository::AppState;

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

const TENANT_TABLES: &[&str] = &[
    "roster_change_notices",
    "roster_months",
    "confirmed_shift_plans",
    "audit_logs",
    "shift_weekday_times",
    "shifts",
    "workstations",
    "employees",
];

/// Months far enough ahead that "published" stays published whatever today is.
const PUBLISHED: [&str; 2] = ["2098-03-01", "2098-04-01"];
const DRAFT: &str = "2098-05-01";
/// A month someone published and then unpublished: a stored `draft` row.
const UNPUBLISHED: &str = "2098-06-01";
const LOCKED: &str = "2098-01-01";

#[derive(Clone, Copy, Debug)]
enum Kind {
    Shift,
    Employee,
    Workstation,
}

const KINDS: [Kind; 3] = [Kind::Shift, Kind::Employee, Kind::Workstation];

impl Kind {
    fn path(self) -> &'static str {
        match self {
            Kind::Shift => "/shifts",
            Kind::Employee => "/employees",
            Kind::Workstation => "/workstations",
        }
    }

    fn table(self) -> &'static str {
        match self {
            Kind::Shift => "shifts",
            Kind::Employee => "employees",
            Kind::Workstation => "workstations",
        }
    }
}

/// One nurse, one shift (with its weekday times), one ward.
struct Set {
    employee: Uuid,
    shift: Uuid,
    ward: Uuid,
}

impl Set {
    fn id(&self, kind: Kind) -> Uuid {
        match kind {
            Kind::Shift => self.shift,
            Kind::Employee => self.employee,
            Kind::Workstation => self.ward,
        }
    }
}

#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type = BigInt)]
    n: i64,
}

struct TestApp {
    base_url: String,
    keys: TestKeys,
    pool: DbPool,
    tenant: String,
}

impl TestApp {
    async fn spawn() -> Option<Self> {
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
        let pool: DbPool = match Pool::builder()
            .max_size(4)
            .connection_timeout(Duration::from_secs(2))
            .build(ConnectionManager::<PgConnection>::new(url))
        {
            Ok(pool) => pool,
            Err(e) => {
                eprintln!("skipping delete guard tests: no database ({e})");
                return None;
            }
        };
        {
            // Test binaries run one after another, but the tests inside one start
            // together; migrating a fresh database from several threads collides.
            static MIGRATING: std::sync::Mutex<()> = std::sync::Mutex::new(());
            let _guard = MIGRATING.lock().unwrap_or_else(|e| e.into_inner());
            shift::database::run_migrations(&pool).expect("migrations");
        }

        let keys = TestKeys::serve().await;
        let mut state = AppState::new(Arc::new(pool.clone()));
        state.token_verifier = Some(keys.verifier());
        let app = shift::server::create_router(state);
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let app = Self {
            base_url: format!("http://{addr}/api/v1"),
            keys,
            pool,
            tenant: format!("test-delete-guard-{}", Uuid::new_v4()),
        };
        app.sql(&format!(
            "INSERT INTO roster_months (tenant_id, month, status) VALUES \
             ('{t}', '{}', 'published'), ('{t}', '{}', 'published'), ('{t}', '{UNPUBLISHED}', 'draft'), ('{t}', '{LOCKED}', 'locked')",
            PUBLISHED[0],
            PUBLISHED[1],
            t = app.tenant
        ));
        Some(app)
    }

    fn sql(&self, statement: &str) {
        let mut conn = self.pool.get().expect("connection");
        diesel::sql_query(statement).execute(&mut conn).unwrap_or_else(|e| panic!("{statement}: {e}"));
    }

    fn try_sql(&self, statement: &str) -> Result<usize, diesel::result::Error> {
        let mut conn = self.pool.get().expect("connection");
        diesel::sql_query(statement).execute(&mut conn)
    }

    fn count(&self, query: &str) -> i64 {
        let mut conn = self.pool.get().expect("connection");
        diesel::sql_query(query)
            .get_result::<Count>(&mut conn)
            .unwrap_or_else(|e| panic!("{query}: {e}"))
            .n
    }

    /// A fresh nurse, shift and ward, rostered on the 5th and 6th of each of `months`.
    fn seed(&self, months: &[&str]) -> Set {
        let tenant = &self.tenant;
        let set = Set { employee: Uuid::new_v4(), shift: Uuid::new_v4(), ward: Uuid::new_v4() };
        let Set { employee, shift, ward } = &set;
        self.sql(&format!(
            "INSERT INTO employees (id, name, email, tenant_id) VALUES ('{employee}', 'Anna', '{employee}@test.invalid', '{tenant}')"
        ));
        self.sql(&format!("INSERT INTO shifts (id, name, tenant_id) VALUES ('{shift}', 'Early {shift}', '{tenant}')"));
        for weekday in 0..7 {
            self.sql(&format!(
                "INSERT INTO shift_weekday_times (id, shift_id, weekday, start_time, end_time, min_employees, free_days_after_shift, tenant_id) \
                 VALUES ('{}', '{shift}', {weekday}, '06:00', '14:00', 1, 0, '{tenant}')",
                Uuid::new_v4()
            ));
        }
        self.sql(&format!(
            "INSERT INTO workstations (id, name, available, active_shift_ids, priority, min_employees, tenant_id) \
             VALUES ('{ward}', 'Ward {ward}', true, '{{}}', 'medium', 1, '{tenant}')"
        ));
        for month in months {
            for day in ["05", "06"] {
                let date = format!("{}-{day}", &month[..7]);
                self.sql(&format!(
                    "INSERT INTO confirmed_shift_plans (employee_id, shift_id, workstation_id, date, is_present, tenant_id) \
                     VALUES ('{employee}', '{shift}', '{ward}', '{date}', true, '{tenant}')"
                ));
            }
        }
        set
    }

    async fn delete(&self, kind: Kind, id: Uuid) -> (u16, Value) {
        let token = self.keys.sign(json!({
            "sub": "planner@test.invalid",
            "tenant": [self.tenant],
            "realm_access": { "roles": ["shift-planner"] },
            "email": "planner@test.invalid",
            "preferred_username": "planner@test.invalid",
        }));
        let response = reqwest::Client::new()
            .delete(format!("{}{}/{id}", self.base_url, kind.path()))
            .header("x-access-token", token)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    fn exists(&self, kind: Kind, id: Uuid) -> bool {
        self.count(&format!("SELECT COUNT(*) AS n FROM {} WHERE id = '{id}'", kind.table())) == 1
    }

    /// Roster entries of `set`'s nurse, and how many of them still have the ward.
    fn entries(&self, set: &Set) -> (i64, i64) {
        let all = format!("SELECT COUNT(*) AS n FROM confirmed_shift_plans WHERE tenant_id = '{}'", self.tenant);
        let mine = format!("{all} AND (employee_id = '{}' OR shift_id = '{}' OR workstation_id = '{}')", set.employee, set.shift, set.ward);
        (self.count(&mine), self.count(&format!("{mine} AND workstation_id = '{}'", set.ward)))
    }

    fn weekday_times(&self, set: &Set) -> i64 {
        self.count(&format!("SELECT COUNT(*) AS n FROM shift_weekday_times WHERE shift_id = '{}'", set.shift))
    }
}

impl Drop for TestApp {
    fn drop(&mut self) {
        for table in TENANT_TABLES {
            let _ = self.try_sql(&format!("DELETE FROM {table} WHERE tenant_id = '{}'", self.tenant));
        }
    }
}

fn message(body: &Value) -> &str {
    body["error"].as_str().unwrap_or_default()
}

#[tokio::test]
async fn an_item_used_in_a_published_month_is_not_deleted() {
    let Some(app) = TestApp::spawn().await else { return };
    for kind in KINDS {
        let set = app.seed(&[PUBLISHED[0], PUBLISHED[1], DRAFT]);
        let (status, body) = app.delete(kind, set.id(kind)).await;

        assert_eq!(status, 409, "{kind:?}: {body}");
        let msg = message(&body);
        assert!(msg.contains("2098-03") && msg.contains("2098-04"), "{kind:?} names both published months: {msg}");
        assert!(!msg.contains("2098-05"), "{kind:?} does not name the draft month: {msg}");
        assert!(msg.contains("published or locked") && msg.contains("(4 entries)"), "{kind:?}: {msg}");

        assert!(app.exists(kind, set.id(kind)), "{kind:?} is still there");
        assert_eq!(app.entries(&set), (6, 6), "{kind:?}: no entry removed or detached, the draft ones neither");
        assert_eq!(app.weekday_times(&set), 7, "{kind:?}: the shift keeps its weekday times");
    }
}

#[tokio::test]
async fn an_item_used_in_a_locked_month_is_not_deleted() {
    let Some(app) = TestApp::spawn().await else { return };
    for kind in KINDS {
        let set = app.seed(&[LOCKED]);
        let (status, body) = app.delete(kind, set.id(kind)).await;

        assert_eq!(status, 409, "{kind:?}: {body}");
        assert!(message(&body).contains("2098-01"), "{kind:?}: {body}");
        assert!(app.exists(kind, set.id(kind)), "{kind:?} is still there");
        assert_eq!(app.entries(&set), (2, 2), "{kind:?}");
        assert_eq!(app.weekday_times(&set), 7, "{kind:?}");
    }
}

#[tokio::test]
async fn a_published_month_that_has_ended_counts_as_locked() {
    let Some(app) = TestApp::spawn().await else { return };
    app.sql(&format!("INSERT INTO roster_months (tenant_id, month, status) VALUES ('{}', '2001-02-01', 'published')", app.tenant));
    let set = app.seed(&["2001-02-01"]);
    let (status, body) = app.delete(Kind::Employee, set.employee).await;
    assert_eq!(status, 409, "{body}");
    assert!(message(&body).contains("2001-02"), "{body}");
    assert!(app.exists(Kind::Employee, set.employee));
}

#[tokio::test]
async fn an_item_used_in_draft_months_only_is_deleted_with_its_draft_entries() {
    let Some(app) = TestApp::spawn().await else { return };
    for kind in KINDS {
        let set = app.seed(&[DRAFT, UNPUBLISHED]);
        let (status, body) = app.delete(kind, set.id(kind)).await;

        assert_eq!(status, 200, "{kind:?}: {body}");
        assert!(!app.exists(kind, set.id(kind)), "{kind:?} is gone");
        match kind {
            // The ward's entries stay, without a ward.
            Kind::Workstation => assert_eq!(app.entries(&set), (4, 0), "{kind:?}"),
            _ => assert_eq!(app.entries(&set), (0, 0), "{kind:?}"),
        }
        let times = if matches!(kind, Kind::Shift) { 0 } else { 7 };
        assert_eq!(app.weekday_times(&set), times, "{kind:?}");
    }
}

#[tokio::test]
async fn an_unused_item_is_deleted() {
    let Some(app) = TestApp::spawn().await else { return };
    for kind in KINDS {
        let set = app.seed(&[]);
        let (status, body) = app.delete(kind, set.id(kind)).await;
        assert_eq!(status, 200, "{kind:?}: {body}");
        assert!(!app.exists(kind, set.id(kind)), "{kind:?} is gone");
    }
}

#[tokio::test]
async fn the_database_refuses_to_drop_roster_entries_with_their_item() {
    let Some(app) = TestApp::spawn().await else { return };
    for kind in KINDS {
        let set = app.seed(&[DRAFT]);
        let result = app.try_sql(&format!("DELETE FROM {} WHERE id = '{}'", kind.table(), set.id(kind)));
        assert!(result.is_err(), "{kind:?}: a plain DELETE must not take roster entries with it");
        assert_eq!(app.entries(&set), (2, 2), "{kind:?}");
    }
}
