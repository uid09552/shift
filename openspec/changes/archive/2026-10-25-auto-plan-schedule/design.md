# Design

## Context

What the code does today, and what it means for an unattended run:

- **Planning is a request/response over NATS.** `POST /planner/plan` →
  `OptimizerService::schedule` stores a `planning_tasks` row for the tenant,
  publishes the payload, and returns a task id. The solver answers on
  `scheduling.results`; `handle_result_message` stores the result and marks the
  task done. `OptimizerService::schedule` already takes a tenant id.
- **The answer is filed under the wrong tenant.** The payload carries no tenant,
  and the handler uses `state.default_tenant_id`, so `update_planning_task_done`
  looks for the task in the default tenant. For any other tenant the task is
  never found and stays running. A per-tenant job cannot work on that.
- **Taking over is a request handler.** `take_as_plan` converts a result to
  confirmed entries and calls `replace_confirmed_shift_plans_for_period`, which
  **deletes every confirmed entry of those employees in the period**, manual ones
  included, then inserts the plan (a `free` entry for every unassigned day). A
  planner accepts that after a dialog; a job must not. A hard unavailability is
  mirrored into the roster as a manual `unavailable` entry; recorded absences
  (`sick`, `day_off`, `holiday`, `unknown`) are manual entries the solver is not
  told about.
- **The guard decides by month status.** `RosterChangeCtx::decide` answers
  `Silent` for draft months, `Tracked` (change notices) for published ones, and
  refuses locked months or the freeze window without an admin or a reason.
- **The agent's plan check needs a user.** `/plan/validate` fetches the plan
  through MCP *as the signed-in user*. A job has no token, so it cannot use it.
  The solver's own output is what is left: `status` and a `message` that lists
  slots below minimum staffing, fixed assignments not kept, ignored locks and
  exceeded personal limits. With `labor_law_profile` on, the law is already a
  hard rule in the solver.
- **A job precedent exists.** `wish_schedule` ticks every 60 s over every
  tenant's settings, and `WishScheduleDomain::occurs_on` already does the
  "every N weeks on a weekday from a start date" arithmetic.
- **Time.** The roster rules use the server's local date (`roster_guard::today`).

## Goals / Non-Goals

**Goals:**
- A tenant sets a rhythm and a range once; the roster fills itself in step with
  the rules a planner already knows.
- An automatic run can never do worse than a proposal: it cannot publish, cannot
  notify employees, cannot overwrite a person's entry.
- Each tenant is independent, and the job is safe with restarts and several
  backend instances.

**Non-Goals:**
- Anything in the proposal's non-goals: publishing, notifications, the agent's
  check, absences recorded by hand fed to the solver, a *run now* button,
  per-tenant time zones.

## Decisions

### 1. Settings live on `planner_settings`

New columns (migration `00000000000037_auto_plan`), all defaulting to "off":

| column | type | meaning |
|---|---|---|
| `auto_plan_enabled` | bool, false | the schedule is on |
| `auto_plan_every_weeks` | smallint, 4 | 1–12 |
| `auto_plan_weekday` | smallint, 0 | 0 = Monday … 6 = Sunday, as the wish schedule |
| `auto_plan_time` | time, 02:00 | server local time |
| `auto_plan_start_date` | date, null | anchors the cycle; required while enabled |
| `auto_plan_range_unit` | varchar, `weeks` | `weeks` \| `months` |
| `auto_plan_range_count` | smallint, 4 | weeks ∈ {2,4,6,8,12}; months ∈ {1,2,3} |
| `auto_plan_armed_at` | timestamptz, null | when enabled or any schedule field last changed |
| `auto_plan_last_run_on` | date, null | the run day last claimed |
| `auto_plan_last_outcome` | varchar, null | `running`, `taken_over`, `kept_as_proposal`, `skipped`, `failed` |
| `auto_plan_last_note` | text, null | the reason, in words |
| `auto_plan_last_task_id` | uuid, null | the run, for the link to the Runs tab |

The unit/count pair is validated against the eight presets, so the UI offers
one dropdown ("2 weeks" … "3 months") and the API stays explicit. The last four
columns are written only by the job; `PUT` ignores them. `GET` adds a computed
read-only `auto_plan_next_run` (local date-time, or null).

`auto_plan_armed_at` is set by the service on a `PUT` that changes the enabled
flag or any schedule field. A run day whose time is **before** `armed_at` does
not run: a planner who switches the schedule on at 14:00 on a Monday does not get
a surprise run at once.

*Alternative considered:* a separate `auto_plan_settings` table, like
`wish_settings`. Rejected: the spec places the setting in the planner settings,
the page and `PUT` are already there, and one row per tenant exists.

As built: `auto_plan_armed_at` is a `TIMESTAMP` (not `TIMESTAMPTZ`) holding the
server's local time, the same clock as the run time, and one more job-written column,
`auto_plan_last_started_at`, lets the tick fail a run still `running` after three
hours even when no planning task row exists.

The new fields are added to the list of settings a use case must not change
(`PresetValues` in `planner-settings.presets.ts` omits them), as `use_case` was
by `store-planner-use-case`, whose migration took number 36.

### 2. One tick, one atomic claim

`services/auto_plan.rs` exposes `spawn(state)`, started in `main.rs` next to
`wish_schedule::spawn`. Every 60 s it loads the tenants with
`auto_plan_enabled` and, for each, decides whether a run is due:

```
today = Local::now().date, now = Local::now()
due  = occurs_on(today) && now >= today@auto_plan_time
       && today@auto_plan_time >= armed_at
       && auto_plan_last_run_on != today
```

`occurs_on` is extracted from `WishScheduleDomain` into a shared
`weekly_occurrence(start, weekday, interval, date)` function, tested with the
wish schedule's cases, so the two settings agree on what "every 2nd Monday" means.

Due tenants are **claimed** with one statement:

```sql
UPDATE planner_settings
   SET auto_plan_last_run_on = $today, auto_plan_last_outcome = 'running', …
 WHERE tenant_id = $t AND auto_plan_enabled
   AND (auto_plan_last_run_on IS NULL OR auto_plan_last_run_on < $today)
```

Only the instance whose update touched a row goes on. That makes a restart, a
second instance and a slow tick all harmless. A run day on which the server is
down is **not** made up: the next run day plans the gap, since the range starts
after the last planned day.

The same tick fails a run still `running` three hours after it started (the
limit the spec already uses for stale tasks), so a result that never arrives does
not leave the settings saying *running*.

### 3. The range

```
last   = max(date) of confirmed entries with a shift (is_present, shift_id set)
start  = max(last + 1, run_day + 1)
end    = run_day + N weeks      (7·N days)
       | run_day + N months     (chrono::Months — clamps: 31 Jan + 1 month = 28 Feb)
start > end  →  outcome skipped, "already planned until <last>"
```

Anchoring on the last shift (not the last entry) keeps absences and free days
entered far ahead from pushing the start out. A stray shift entered far in the
future *does* push it, and silently suppresses planning until the roster catches
up. The `skipped` outcome says until when, which is how it is noticed; it is the
price of never overwriting a planned day.

By construction the window holds no shift entries at all: only absences, free
days and nothing.

### 4. Starting the run

The job calls `OptimizerService::schedule` with no employee filter, the computed
dates, and `build_constraints` (made `pub(crate)`) so the run uses the tenant's
current planner settings. `schedule` gains a `source` (`manual` | `auto`), stored
in a new `planning_tasks.source` column (default `manual`). `trigger_plan` passes
`manual`. A start failure (no NATS, data unreadable) is an immediate `failed`
outcome with the error text.

Audit: `planner.auto_run` when the run starts (the window and task id),
`planner.auto_result` when it finishes (the outcome and note), actor
`auto-planner`. The audit-log page gets labels for both.

### 5. Results go to the tenant that asked

`handle_result_message` first looks the task up by id alone
(`PlanningTaskRepository::find_planning_task(id)`, returning the task with its
tenant). Job ids are random UUIDs, so this crosses no boundary. It uses that
tenant for storing the result and updating the task, and falls back to the
default tenant only for a task it cannot find (legacy messages). The stored
result gets the task's `source` (a new optional field on `TaskResultDto`), which
the Runs tab uses for its *Automatic* badge.

### 6. Taking over

After storing the result and completing the task, the handler calls
`auto_plan::on_result` when the task's source is `auto`; on a solver error it
calls `on_failure`. `on_result` is a short pipeline with a pure decision in the
middle, so the rules are unit-testable without NATS or a database:

```
entries = entries_from_plan(result)                // shared with take_as_plan
decide(result, month_statuses, recorded_absences, closed_workstations, entries)
   -> TakeOver | Keep(reason)
```

`Keep` when: status is not `optimal`/`feasible`; `message` is not empty; any
month in the window is not `draft`; the plan assigns someone on a recorded
absence (`sick`, `day_off`, `holiday`, `unknown`; the `unavailable` mirrors are
known to the solver and are no conflict); or an assignment falls on a closed
workstation (the check `take_as_plan` already makes).

`TakeOver` writes with a new `apply_automated_plan` repository method, inside
`rostertracking::guarded` with a context of `is_admin = false`, no reason, source
`TakeAsPlan`, actor `auto-planner`. It
- deletes only entries with `creation_type = 'automated'` in the window,
- inserts the plan's entries with `ON CONFLICT DO NOTHING`, so a day that still
  has an entry (a manual one) is left as it is.

At the repository level the guard alone does not refuse a far-future *published*
month (it only tracks it); that refusal is `decide`'s job above. The guard is the
second line of defence for what changed between the check and the write: a month
locked meanwhile, or a published day that has since come inside the freeze window.

If the guard refuses anyway (something changed between the check and the write),
the answer is `Keep(<the guard's message>)`. Nothing is written in a refused
transaction. `take_as_plan` and the job share `entries_from_plan`, the
plan-to-entries conversion, which is extracted from the handler.

Nothing here calls the publish endpoints, so months stay `draft`; the existing
*publish due* warning remains the nudge to a planner.

*Alternatives considered:*
- Reusing `replace_confirmed_shift_plans_for_period`. Rejected: it deletes manual
  entries, the thing this change promises not to do.
- Calling the agent's `/plan/validate`. Rejected: it needs a user token. The
  solver's `message` carries the same hard facts (short slots, dropped locks,
  exceeded limits), and the law is a hard rule in the solver.
- Taking over into published months with change notices. Rejected: employees
  would be notified of changes no human decided.

### 7. Outcome and the UI

Every path ends by writing `auto_plan_last_outcome` / `_note` / `_task_id` and
the `planner.auto_result` audit entry. Notes are plain sentences ("2 slots below
minimum staffing: …", "October 2026 is published", "Anna Berg is recorded as
sick on 2026-11-03 but is planned").

The planner-settings page gets an *Automatic planning* section: a switch; "every
[n] weeks on [weekday] at [time], starting [date]"; "plan the next [range]"; and
a status block (next run, last run, outcome, a link to `/scheduler?tab=runs`).
Enabling pre-fills the start date with the next occurrence of the chosen weekday.
The Runs tab shows an *Automatic* badge on results and jobs with
`source = 'auto'`. Strings go in `de.ts` and `en.ts`.

## Risks / Trade-offs

- [A stray future shift hides planning] → The `skipped` outcome names the date;
  see decision 3.
- [Absences recorded by hand are not known to the solver, so plans collide with
  them and stay proposals] → Safe by design; the note names the person and day.
  Feeding them to the solver is the first follow-up.
- [The result never arrives (planner down)] → The tick fails the run after three
  hours; the next run day tries again.
- [Local time and DST] → The run happens at the first tick at or after the time,
  so a skipped hour moves it by up to an hour, and a repeated hour cannot run it
  twice (the claim is per day).
- [The solver's `message` is free text] → "Nothing to flag" is its absence, not a
  parse of it, so a new kind of warning in the planner keeps the plan out of the
  roster rather than slipping in.
- [An existing deployment with several tenants had results lost] → Fixed by
  decision 5. No data repair: the stuck tasks are the stale ones the existing
  sweep already fails.

## Migration Plan

One additive migration, everything off by default, so an upgrade changes no
behaviour until a planner switches the schedule on. The down migration drops the
new columns. Deploy backend and UI together: the new settings fields are
optional on `PUT`, so an old UI keeps working against the new backend.

## Open Questions

- Whether the automatic run should also be offered to run on demand for testing.
  Left out; it does not change the model and can be added with the same code path.
