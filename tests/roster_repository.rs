//! Repository tests for the roster lifecycle tables: month status transitions
//! and change notices, against a real database. Each test works in its own
//! throwaway tenant and deletes what it created. Needs PostgreSQL
//! (`DATABASE_URL`, or the development default); without one the tests print a
//! notice and pass.

use std::sync::Arc;
use std::time::Duration;

use chrono::NaiveDate;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use uuid::Uuid;

use shift::database::DbPool;
use shift::models::{NewEmployee, NewRosterChangeNotice};
use shift::repository::domain::{
    MonthStatus, NoticeFilter, RosterChangeNoticeRepository, RosterMonthRepository, RosterMonthTransition,
};
use shift::repository::rosterrepository::{DieselRosterChangeNoticeRepository, DieselRosterMonthRepository};
use shift::schema::{employees, roster_change_notices, roster_months};

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5432/shift";

fn pool() -> Option<DbPool> {
    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
    match Pool::builder()
        .max_size(2)
        .connection_timeout(Duration::from_secs(2))
        .build(ConnectionManager::<PgConnection>::new(url))
    {
        Ok(pool) => {
            shift::database::run_migrations(&pool).expect("migrations");
            Some(pool)
        }
        Err(e) => {
            eprintln!("skipping roster repository tests: no database ({e})");
            None
        }
    }
}

fn date(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn publish(month: NaiveDate) -> RosterMonthTransition {
    RosterMonthTransition {
        month,
        from: vec![MonthStatus::Draft],
        to: MonthStatus::Published,
        actor: Some("planner@test.invalid".into()),
        reopened: false,
    }
}

fn cleanup(pool: &DbPool, tenant: &str) {
    let mut conn = pool.get().unwrap();
    let _ = diesel::delete(roster_months::table.filter(roster_months::tenant_id.eq(tenant))).execute(&mut conn);
    let _ = diesel::delete(roster_change_notices::table.filter(roster_change_notices::tenant_id.eq(tenant))).execute(&mut conn);
    let _ = diesel::delete(employees::table.filter(employees::tenant_id.eq(tenant))).execute(&mut conn);
}

#[tokio::test]
async fn a_month_is_published_once_and_the_publisher_is_recorded() {
    let Some(pool) = pool() else { return };
    let tenant = format!("test-roster-repo-{}", Uuid::new_v4());
    let repo = DieselRosterMonthRepository { pool: Arc::new(pool.clone()) };
    let today = date(2026, 10, 9);

    assert!(repo.list_roster_months(&tenant, date(2026, 11, 1), date(2026, 12, 1)).await.unwrap().is_empty(),
        "an untouched month has no row: it is draft");

    let published = repo.transition_roster_month(&tenant, publish(date(2026, 11, 15)), today).await.unwrap()
        .expect("a draft month can be published");
    assert_eq!(published.month, date(2026, 11, 1), "stored by its first day");
    assert_eq!(published.status, MonthStatus::Published);
    assert_eq!(published.published_by.as_deref(), Some("planner@test.invalid"));
    assert!(published.published_at.is_some());

    assert!(repo.transition_roster_month(&tenant, publish(date(2026, 11, 1)), today).await.unwrap().is_none(),
        "publishing twice is refused");

    let listed = repo.list_roster_months(&tenant, date(2026, 10, 1), date(2026, 12, 31)).await.unwrap();
    assert_eq!(listed.len(), 1);

    cleanup(&pool, &tenant);
}

#[tokio::test]
async fn a_past_published_month_must_be_unlocked_not_published() {
    let Some(pool) = pool() else { return };
    let tenant = format!("test-roster-repo-{}", Uuid::new_v4());
    let repo = DieselRosterMonthRepository { pool: Arc::new(pool.clone()) };

    repo.transition_roster_month(&tenant, publish(date(2026, 9, 1)), date(2026, 8, 20)).await.unwrap().unwrap();
    let today = date(2026, 10, 9);
    // September is over: it reads as locked, so "unpublish" (from published) is refused…
    let unpublish = RosterMonthTransition { month: date(2026, 9, 1), from: vec![MonthStatus::Published], to: MonthStatus::Draft, actor: None, reopened: false };
    assert!(repo.transition_roster_month(&tenant, unpublish, today).await.unwrap().is_none());
    // …and "unlock" (from locked) reopens it.
    let unlock = RosterMonthTransition { month: date(2026, 9, 1), from: vec![MonthStatus::Locked], to: MonthStatus::Published, actor: Some("admin".into()), reopened: true };
    let reopened = repo.transition_roster_month(&tenant, unlock, today).await.unwrap().expect("unlocked");
    assert_eq!(reopened.effective_status(today), MonthStatus::Published);
    assert_eq!(reopened.published_by.as_deref(), Some("planner@test.invalid"), "the original publisher is kept");

    cleanup(&pool, &tenant);
}

#[tokio::test]
async fn notices_are_listed_counted_and_acknowledged_only_by_their_employee() {
    let Some(pool) = pool() else { return };
    let tenant = format!("test-roster-repo-{}", Uuid::new_v4());
    let repo = DieselRosterChangeNoticeRepository { pool: Arc::new(pool.clone()) };

    let mut conn = pool.get().unwrap();
    let mut person = |name: &str| -> Uuid {
        let email = format!("{name}-{}@test.invalid", Uuid::new_v4());
        diesel::insert_into(employees::table)
            .values(NewEmployee { name, email: &email, weekly_working_hours: None, tenant_id: &tenant })
            .returning(employees::id)
            .get_result(&mut conn)
            .unwrap()
    };
    let (anna, ben) = (person("Anna"), person("Ben"));
    let notice = |employee_id: Uuid, day: u32| NewRosterChangeNotice {
        tenant_id: tenant.clone(),
        employee_id,
        date: date(2026, 11, day),
        before: None,
        after: Some(serde_json::json!({ "shift_id": null, "workstation_id": null, "absence_type": "free" })),
        source: "manual".into(),
        actor: Some("planner".into()),
        reason: None,
    };
    let ids: Vec<Uuid> = diesel::insert_into(roster_change_notices::table)
        .values(vec![notice(anna, 3), notice(anna, 4), notice(ben, 3)])
        .returning(roster_change_notices::id)
        .get_results(&mut conn)
        .unwrap();
    drop(conn);

    let annas = repo.list_notices(&tenant, NoticeFilter { employee_id: Some(anna), ..Default::default() }).await.unwrap();
    assert_eq!(annas.len(), 2);
    assert_eq!(annas[0].after.as_ref().unwrap().absence_type.as_deref(), Some("free"));
    assert_eq!(repo.count_unacknowledged(&tenant, anna).await.unwrap(), 2);

    let refused = repo.acknowledge_notices(&tenant, anna, Some(vec![ids[2]])).await;
    assert!(matches!(refused, Err(shift::errors::AppError::Forbidden(_))), "Ben's notice is not Anna's to acknowledge");
    assert_eq!(repo.count_unacknowledged(&tenant, ben).await.unwrap(), 1, "and it stays unread");

    assert_eq!(repo.acknowledge_notices(&tenant, anna, Some(vec![ids[0]])).await.unwrap(), 1);
    assert_eq!(repo.count_unacknowledged(&tenant, anna).await.unwrap(), 1);
    assert_eq!(repo.acknowledge_notices(&tenant, anna, None).await.unwrap(), 1, "all the rest");
    assert_eq!(repo.count_unacknowledged(&tenant, anna).await.unwrap(), 0);

    let unread = repo.list_notices(&tenant, NoticeFilter { acknowledged: Some(false), ..Default::default() }).await.unwrap();
    assert_eq!(unread.len(), 1, "only Ben's is left unread");
    assert_eq!(unread[0].employee_id, ben);

    cleanup(&pool, &tenant);
}

mod tracking {
    use super::*;
    use shift::repository::confirmedshiftplanrepository::DieselConfirmedShiftPlanRepository;
    use shift::repository::domain::{ChangeSource, ConfirmedShiftPlan, ConfirmedShiftPlanRepository};
    use shift::schema::confirmed_shift_plans;
    use shift::services::roster_guard::RosterChangeCtx;

    fn ctx(today: NaiveDate) -> RosterChangeCtx {
        RosterChangeCtx {
            is_admin: false,
            actor: Some("planner".into()),
            reason: None,
            source: ChangeSource::Manual,
            today,
            freeze_days: 7,
        }
    }

    fn free_day(employee_id: Uuid, date: NaiveDate) -> ConfirmedShiftPlan {
        ConfirmedShiftPlan {
            id: Uuid::new_v4(),
            employee_id,
            shift_id: None,
            workstation_id: None,
            date,
            is_present: false,
            absence_type: Some("free".into()),
            creation_type: "manual".into(),
            created_at: Default::default(),
            updated_at: Default::default(),
        }
    }

    fn notice_count(pool: &DbPool, tenant: &str) -> i64 {
        let mut conn = pool.get().unwrap();
        roster_change_notices::table
            .filter(roster_change_notices::tenant_id.eq(tenant))
            .count()
            .get_result(&mut conn)
            .unwrap()
    }

    #[tokio::test]
    async fn a_published_edit_writes_one_notice_an_identical_one_none_and_a_draft_one_none() {
        let Some(pool) = pool() else { return };
        let tenant = format!("test-roster-repo-{}", Uuid::new_v4());
        let months = DieselRosterMonthRepository { pool: Arc::new(pool.clone()) };
        let roster = DieselConfirmedShiftPlanRepository { pool: Arc::new(pool.clone()) };
        let today = date(2026, 10, 9);
        let anna = {
            let mut conn = pool.get().unwrap();
            let email = format!("anna-{}@test.invalid", Uuid::new_v4());
            diesel::insert_into(employees::table)
                .values(NewEmployee { name: "Anna", email: &email, weekly_working_hours: None, tenant_id: &tenant })
                .returning(employees::id)
                .get_result::<Uuid>(&mut conn)
                .unwrap()
        };
        months.transition_roster_month(&tenant, publish(date(2026, 11, 1)), today).await.unwrap().unwrap();

        // November is published: the new free day is a change.
        roster.create_confirmed_shift_plan(&tenant, free_day(anna, date(2026, 11, 20)), &ctx(today)).await.unwrap();
        assert_eq!(notice_count(&pool, &tenant), 1);

        // Writing exactly the same again changes nothing.
        roster.create_confirmed_shift_plan(&tenant, free_day(anna, date(2026, 11, 20)), &ctx(today)).await.unwrap();
        assert_eq!(notice_count(&pool, &tenant), 1, "an identical write is no change");

        // December is draft: silent.
        roster.create_confirmed_shift_plan(&tenant, free_day(anna, date(2026, 12, 2)), &ctx(today)).await.unwrap();
        assert_eq!(notice_count(&pool, &tenant), 1, "draft months are not tracked");

        // The notice describes the step: nothing → free.
        let notice = DieselRosterChangeNoticeRepository { pool: Arc::new(pool.clone()) }
            .list_notices(&tenant, NoticeFilter::default())
            .await
            .unwrap()
            .remove(0);
        assert_eq!(notice.before, None);
        assert_eq!(notice.after.unwrap().absence_type.as_deref(), Some("free"));
        assert_eq!(notice.actor.as_deref(), Some("planner"));

        let mut conn = pool.get().unwrap();
        let _ = diesel::delete(confirmed_shift_plans::table.filter(confirmed_shift_plans::tenant_id.eq(&tenant))).execute(&mut conn);
        drop(conn);
        cleanup(&pool, &tenant);
    }

    #[tokio::test]
    async fn a_refused_write_changes_nothing() {
        let Some(pool) = pool() else { return };
        let tenant = format!("test-roster-repo-{}", Uuid::new_v4());
        let roster = DieselConfirmedShiftPlanRepository { pool: Arc::new(pool.clone()) };
        let anna = {
            let mut conn = pool.get().unwrap();
            let email = format!("anna-{}@test.invalid", Uuid::new_v4());
            diesel::insert_into(employees::table)
                .values(NewEmployee { name: "Anna", email: &email, weekly_working_hours: None, tenant_id: &tenant })
                .returning(employees::id)
                .get_result::<Uuid>(&mut conn)
                .unwrap()
        };
        {
            let mut conn = pool.get().unwrap();
            diesel::insert_into(roster_months::table)
                .values((roster_months::tenant_id.eq(&tenant), roster_months::month.eq(date(2026, 9, 1)), roster_months::status.eq("locked")))
                .execute(&mut conn)
                .unwrap();
        }

        let refused = roster.create_confirmed_shift_plan(&tenant, free_day(anna, date(2026, 9, 20)), &ctx(date(2026, 10, 9))).await;
        assert!(matches!(refused, Err(shift::errors::AppError::Forbidden(_))), "a planner may not write a locked month");
        let mut conn = pool.get().unwrap();
        let rows: i64 = confirmed_shift_plans::table
            .filter(confirmed_shift_plans::tenant_id.eq(&tenant))
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(rows, 0);
        drop(conn);
        assert_eq!(notice_count(&pool, &tenant), 0);
        cleanup(&pool, &tenant);
    }
}
