//! Every write to `confirmed_shift_plans` runs through `guarded`: it reads the
//! status of the months it touches (`FOR SHARE`, so nobody publishes or locks
//! them meanwhile), asks the roster guard whether the write may go ahead, and —
//! for published and locked months — writes one notice per employee-day the
//! write changed, in the same transaction as the write itself.

use std::collections::{BTreeSet, HashMap};

use chrono::NaiveDate;
use diesel::prelude::*;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models as models;
use crate::repository::domain::{effective_status, month_start, MonthStatus, RosterEntry};
use crate::repository::rosterrepository::month_to_domain;
use crate::schema::{confirmed_shift_plans, roster_change_notices, roster_months};
use crate::services::roster_guard::{RosterChangeCtx, WriteMode};

/// An employee on a day.
pub type Cell = (Uuid, NaiveDate);

/// The effective status of every month the `dates` fall in, read `FOR SHARE`.
pub fn month_statuses(
    conn: &mut PgConnection,
    tenant_id: &str,
    dates: &BTreeSet<NaiveDate>,
    today: NaiveDate,
) -> Result<Vec<(NaiveDate, MonthStatus)>, AppError> {
    let months: BTreeSet<NaiveDate> = dates.iter().map(|d| month_start(*d)).collect();
    let rows: Vec<models::RosterMonth> = roster_months::table
        .filter(roster_months::tenant_id.eq(tenant_id))
        .filter(roster_months::month.eq_any(months.iter().copied().collect::<Vec<_>>()))
        .for_share()
        .load(conn)?;
    let rows: Vec<_> = rows.into_iter().map(month_to_domain).collect();
    Ok(months
        .into_iter()
        .map(|m| (m, effective_status(rows.iter().find(|r| r.month == m), m, today)))
        .collect())
}

/// What `cells` hold in the roster now; a cell without a row is absent.
pub fn snapshot(conn: &mut PgConnection, tenant_id: &str, cells: &[Cell]) -> Result<HashMap<Cell, RosterEntry>, AppError> {
    if cells.is_empty() {
        return Ok(HashMap::new());
    }
    let employees: BTreeSet<Uuid> = cells.iter().map(|c| c.0).collect();
    let (from, to) = (
        cells.iter().map(|c| c.1).min().expect("not empty"),
        cells.iter().map(|c| c.1).max().expect("not empty"),
    );
    let wanted: BTreeSet<Cell> = cells.iter().copied().collect();
    let rows: Vec<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
        .filter(confirmed_shift_plans::tenant_id.eq(tenant_id))
        .filter(confirmed_shift_plans::employee_id.eq_any(employees.into_iter().collect::<Vec<_>>()))
        .filter(confirmed_shift_plans::date.between(from, to))
        .load(conn)?;
    Ok(rows
        .into_iter()
        .filter(|r| wanted.contains(&(r.employee_id, r.date)))
        .map(|r| {
            (
                (r.employee_id, r.date),
                RosterEntry { shift_id: r.shift_id, workstation_id: r.workstation_id, absence_type: r.absence_type },
            )
        })
        .collect())
}

/// The cells whose entry differs between `before` and `after`, in `cells` order.
pub fn changed_cells<'a>(
    cells: &'a [Cell],
    before: &'a HashMap<Cell, RosterEntry>,
    after: &'a HashMap<Cell, RosterEntry>,
) -> impl Iterator<Item = &'a Cell> + 'a {
    cells.iter().filter(move |c| before.get(c) != after.get(c))
}

/// Checks the write against the month statuses of `cells` without writing anything.
pub fn check(conn: &mut PgConnection, tenant_id: &str, ctx: &RosterChangeCtx, cells: &[Cell]) -> Result<WriteMode, AppError> {
    let dates: BTreeSet<NaiveDate> = cells.iter().map(|c| c.1).collect();
    let statuses = month_statuses(conn, tenant_id, &dates, ctx.today)?;
    ctx.decide(&statuses, &dates.into_iter().collect::<Vec<_>>())
}

/// Runs `write` in a transaction if the guard allows a change to `cells`, and
/// records a notice for every cell in a published or locked month it changed.
/// `cells` must cover everything `write` may touch.
pub fn guarded<T>(
    conn: &mut PgConnection,
    tenant_id: &str,
    ctx: &RosterChangeCtx,
    cells: &[Cell],
    write: impl FnOnce(&mut PgConnection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    conn.transaction::<_, AppError, _>(|conn| {
        let dates: BTreeSet<NaiveDate> = cells.iter().map(|c| c.1).collect();
        let statuses = month_statuses(conn, tenant_id, &dates, ctx.today)?;
        let mode = ctx.decide(&statuses, &dates.iter().copied().collect::<Vec<_>>())?;
        if mode == WriteMode::Silent {
            return write(conn);
        }

        let mut seen = BTreeSet::new();
        let tracked: Vec<Cell> = cells
            .iter()
            .copied()
            .filter(|cell| seen.insert(*cell))
            .filter(|(_, date)| {
                let month = month_start(*date);
                statuses.iter().any(|(m, s)| *m == month && *s != MonthStatus::Draft)
            })
            .collect();
        let before = snapshot(conn, tenant_id, &tracked)?;
        let result = write(conn)?;
        let after = snapshot(conn, tenant_id, &tracked)?;

        let as_json = |e: Option<&RosterEntry>| e.and_then(|e| serde_json::to_value(e).ok());
        let notices: Vec<models::NewRosterChangeNotice> = changed_cells(&tracked, &before, &after)
            .map(|cell| models::NewRosterChangeNotice {
                tenant_id: tenant_id.to_string(),
                employee_id: cell.0,
                date: cell.1,
                before: as_json(before.get(cell)),
                after: as_json(after.get(cell)),
                source: ctx.source.as_str().to_string(),
                actor: ctx.actor.clone(),
                reason: ctx.reason.clone(),
            })
            .collect();
        if !notices.is_empty() {
            diesel::insert_into(roster_change_notices::table).values(&notices).execute(conn)?;
        }
        Ok(result)
    })
}

/// Every day from `from` to `to`, for each of `employees`.
pub fn period_cells(employees: &[Uuid], from: NaiveDate, to: NaiveDate) -> Vec<Cell> {
    let mut cells = Vec::new();
    for employee in employees {
        let mut date = from;
        while date <= to {
            cells.push((*employee, date));
            date = date.succ_opt().expect("date in range");
        }
    }
    cells
}

/// Master data a roster entry points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RosterReference {
    Employee,
    Shift,
    Workstation,
}

impl RosterReference {
    /// The `confirmed_shift_plans` column; a fixed name, never user input.
    fn column(self) -> &'static str {
        match self {
            RosterReference::Employee => "employee_id",
            RosterReference::Shift => "shift_id",
            RosterReference::Workstation => "workstation_id",
        }
    }

    fn label(self) -> &'static str {
        match self {
            RosterReference::Employee => "Employee",
            RosterReference::Shift => "Shift",
            RosterReference::Workstation => "Workstation",
        }
    }
}

#[derive(QueryableByName)]
struct MonthUsage {
    #[diesel(sql_type = diesel::sql_types::Text)]
    tenant_id: String,
    #[diesel(sql_type = diesel::sql_types::Date)]
    month: NaiveDate,
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    entries: i64,
}

/// Clears the roster for deleting the employee, shift or workstation `id`
/// (called `name`): refuses with 409 while a published or locked month uses it,
/// otherwise removes the draft entries that use it (a workstation's are only
/// detached). Its foreign keys are `RESTRICT`, so the delete itself fails if
/// anything is left. Call it inside the delete's transaction after locking the
/// item's row `FOR UPDATE`: no new entry can point at it then, and the months
/// read here stay `FOR SHARE` until the delete commits, as in `guarded`.
pub fn release_roster_entries(
    conn: &mut PgConnection,
    reference: RosterReference,
    id: Uuid,
    name: &str,
) -> Result<(), AppError> {
    let column = reference.column();
    let usage: Vec<MonthUsage> = diesel::sql_query(format!(
        "SELECT tenant_id, date_trunc('month', date)::date AS month, COUNT(*) AS entries \
         FROM confirmed_shift_plans WHERE {column} = $1 GROUP BY 1, 2"
    ))
    .bind::<diesel::sql_types::Uuid, _>(id)
    .load(conn)?;

    let today = crate::services::roster_guard::today();
    let mut blocked = BTreeSet::new();
    let mut entries = 0;
    let tenants: BTreeSet<&str> = usage.iter().map(|u| u.tenant_id.as_str()).collect();
    for tenant in tenants {
        let months: BTreeSet<NaiveDate> = usage.iter().filter(|u| u.tenant_id == tenant).map(|u| u.month).collect();
        for (month, status) in month_statuses(conn, tenant, &months, today)? {
            if status != MonthStatus::Draft {
                blocked.insert(month);
                entries += usage.iter().filter(|u| u.tenant_id == tenant && u.month == month).map(|u| u.entries).sum::<i64>();
            }
        }
    }
    if !blocked.is_empty() {
        let months: Vec<String> = blocked.iter().map(|m| m.format("%Y-%m").to_string()).collect();
        let entries = if entries == 1 { "1 entry".to_string() } else { format!("{entries} entries") };
        return Err(AppError::Conflict(format!(
            "{} '{name}' is used in the published or locked roster of {} ({entries}). \
             Change those entries first, or have an admin unpublish or unlock the months.",
            reference.label(),
            months.join(", "),
        )));
    }

    if usage.is_empty() {
        return Ok(());
    }
    let statement = match reference {
        RosterReference::Workstation => format!("UPDATE confirmed_shift_plans SET {column} = NULL WHERE {column} = $1"),
        _ => format!("DELETE FROM confirmed_shift_plans WHERE {column} = $1"),
    };
    diesel::sql_query(statement).bind::<diesel::sql_types::Uuid, _>(id).execute(conn)?;
    Ok(())
}
