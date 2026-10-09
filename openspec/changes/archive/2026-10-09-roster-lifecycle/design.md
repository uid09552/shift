# Design

## Context

The confirmed roster is one table, `confirmed_shift_plans`, with one row per
employee and day: a shift and workstation, or an absence. Five code paths write
to it, and none of them knows about a status:

| Writer | Where |
|---|---|
| Manual create/update/delete | `services/confirmed_shift_plan.rs` |
| Take as Plan (bulk replace per period) | `optimizer::take_as_plan` → `replace_confirmed_shift_plans_for_period` |
| Absence mirror of an unavailability | `services/unavailability.rs` (best-effort, error swallowed) |
| Approved swap (own transaction) | `repository/shiftswaprepository.rs::approve_swap` |
| Replacement | the UI's *Find replacement…* → manual update endpoints |

Roles are enforced by method in `tenant::authenticate`. Viewers may write only
on `SELF_SERVICE_SEGMENTS`. The optimizer input is built once in
`OptimizerService::build_task_dto`. Both `POST /planner/plan` (NATS) and
`POST /planner/prepare` use it, and the agent's `optimizeSchedule` builds on
prepare. The solver runs in two phases: coverage first, then a weighted
objective with a phase-1 hint (`optimizer.py::_solve`). "Today" for the
roster means the server's local date (`shift_swap::today`).

## Goals / Non-Goals

**Goals:**
- One place decides whether a roster write is allowed, so a new writer cannot
  forget the rules.
- A notice is written in the same transaction as the roster change it
  describes. It is never written without the change, and the change never
  happens without its notice.
- No background job is needed for automatic locking.

**Non-Goals:**
- No server push. Notices are polled like the swap count.
- No history of earlier roster versions beyond the notices themselves (no
  snapshot table).
- No change to how a draft month is planned or edited.

## Decisions

### 1. `roster_months` table, effective status computed on read
Columns: `tenant_id`, `month` (date, first of month, PK with tenant),
`status` (`draft|published|locked`), `published_at/by`, `locked_at/by`,
`reopened` (bool, set by an admin unlock).

The effective status is `stored`, except that a `published`, not `reopened`
month whose last day is before today reads as `locked`. A month with no row is
`draft`.
*Alternative:* a nightly job that flips the status. That needs a scheduler the
backend does not have, and leaves a gap until the job runs. Computing on read
is exact and costs nothing. An explicit admin lock sets `status = locked` and
clears `reopened`.

### 2. A single roster guard, enforced in the repository transaction
New `services/roster_guard.rs`:
`check(months_touched, dates_touched, roles, reason) -> Result<WriteMode>`.
It returns `Silent` (all draft) or `Tracked` (some published or locked), or one
of these errors:
- `Forbidden`: locked month and the caller is not an admin.
- `ReasonRequired`: locked month as admin, or a freeze-window date, and no
  reason was given.

Each writer calls the guard before writing. The repository write methods take
a `RosterChangeCtx { mode, source, actor, reason }`. In `Tracked` mode they
load the affected rows, apply the change, and insert the notices, all inside
the same diesel transaction. They also `SELECT … FOR SHARE` the `roster_months`
rows, so a concurrent publish or lock cannot slip in between the check and the
write. `approve_swap` already has its own transaction and calls the same
notice helper inside it.
*Alternative:* a Postgres trigger that diffs rows into notices. It would catch
every writer for free, but the trigger cannot see the actor, the source or the
reason without session variables. Logic split between SQL and Rust is also
harder to test here.

### 3. Reason travels in a header, missing reason is `428`
The reason travels as the request header `X-Change-Reason`, URL-encoded, so no
existing body schema changes. This includes the swap approve call, which has
no body, and take-as-plan. A new `AppError::ReasonRequired(msg)` maps to `428
Precondition Required` with `{"code":"reason_required","message":…}`. A UI
HTTP interceptor catches it, opens the reason dialog, and retries the same
request with the header. Every writer then gets the dialog without per-page
code.
*Alternative:* a `reason` field in each body. That changes five request
schemas and still leaves the swap approval, which has no body.

### 4. Notice rows describe a diff, not a row id
`roster_change_notices`: `id`, `tenant_id`, `employee_id`, `date`, `before`
(jsonb: shift_id, workstation_id, absence_type, or null) and `after` (same),
`source` (`manual|take_as_plan|absence|swap|replacement`), `actor`, `reason`,
`created_at`, `acknowledged_at`. The roster row id is not referenced, because
rows are deleted and re-created by Take as Plan. The diff is computed per
(employee, date): before ≠ after → one notice. Shift and workstation names are
resolved when the notice is read, not stored.

`replacement` is the source when the UI's *Find replacement…* sends
`X-Change-Source: replacement`. Without that header a manual endpoint records
`manual`.

### 5. Viewer filtering in the read endpoints
The confirmed-plan list, per-employee and by-id endpoints drop rows in
effective-draft months when the caller has no planner or admin role. This uses
one `NOT IN (draft months)` filter built from `roster_months` plus the range
the query covers. Months with no row count as draft. The analysis endpoints
are planner pages and stay unfiltered.

### 6. `published_roster` and `change_weight` in the optimizer
`build_task_dto` adds `published_roster: [{employee_id, date, shift_id|null,
workstation_id|null}]` for every period day inside a published or locked
month, where a null shift means "not working". In the solver, for each such
row:
- Working row → `change_e,d ≥ 1 − x[e,d,s,w]`.
- Day off → `change_e,d ≥ x[e,d,s',w']` for every shift and workstation.

`Σ change` becomes the lowest tier of phase 1, below fixed assignments,
coverage and soft personal limits. Its minimum is pinned with the rest before
phase 2 optimises balance, wishes and fatigue. Phase 1's hint starts from the
published roster. The output gains `changes_vs_published: int`.
`change_weight` > 0 switches this on (default 100000) and 0 switches it off.

*Why a tier and not a weight:* a first version priced each change at
`change_weight` in phase 2. Balance is priced per tenth of an hour, though:
`equality_weight` 50000 × 80 tenths for one 8-hour shift is millions. A
per-day weight lost to it, and an uneven published week was reshuffled (found
by `planner/tests/test_published.py`). No single default holds for every shift
length, so stability got its own tier. To rebalance a published month on
purpose, a planner unpublishes it or sets 0.
*Alternative:* lock the published roster with `locked_assignments`. That is
too rigid: a sick day could never move anyone else, and impossible locks
would be dropped silently.

### 7. Settings
`publish_lead_days` (28), `freeze_days` (7) and `change_weight` (100000) are
new columns on `planner_settings`. They are edited on the Planner settings
page. `GET /roster-months?from=YYYY-MM&to=YYYY-MM` returns the effective
status, deadline and `due|overdue|null` for each month, so the dashboard
needs no date logic of its own.

### 8. API
- `GET /roster-months`
- `POST /roster-months/{YYYY-MM}/publish` (planner, admin)
- `/unpublish`, `/unlock`, `/lock` (admin; reason required via header)
- `GET /roster-change-notices` (viewer: own; planner: all, with filters
  `employee_id`, `from`, `to`, `acknowledged`)
- `GET /roster-change-notices/unread-count`
- `POST /roster-change-notices/acknowledge` with body `{ids?: [...]}` (empty =
  all own)

`roster-change-notices` joins `SELF_SERVICE_SEGMENTS`. The handler acks only
the caller's own notices, matched by employee email as swaps do.

## Risks / Trade-offs

- [A writer added later forgets the guard] → The guard's `RosterChangeCtx` is
  a required parameter of every repository write method on
  `ConfirmedShiftPlanRepository`, so it cannot compile without one.
- [Absence mirror is best-effort today; a refused guard would now drop it
  silently] → Run the guard before creating the unavailability, and refuse the
  whole request, so the two never diverge.
- [Viewers lose sight of rows on upgrade] → The migration seeds every month
  that has rows: `published`, or `locked` for past months.
- [Take as Plan into a published month can create hundreds of notices] →
  Notices are written only for days that differ. The UI groups them by date.
  The planner sees the count before confirming, from a dry diff that reuses
  the same code.
- [The change-penalty term grows the model by one bool per employee-day] →
  It applies only to published days, and is linear. Planner tests cover the
  solve time on `input.json`.
- [Timezone: "today" is server-local] → It is the same convention swaps use
  already, and documented.

## Migration Plan

1. Migration `add_roster_lifecycle`: create both tables and add the three
   settings columns with their defaults. Then insert a `roster_months` row for
   every (tenant, month) present in `confirmed_shift_plans`: `locked` if the
   month has ended, otherwise `published`.
2. Deploy the backend, then the planner (it ignores unknown input today, so
   the order is safe), then the agent, then the UI.
3. Rollback: the down migration drops the tables and columns. The roster rows
   themselves are untouched throughout.
