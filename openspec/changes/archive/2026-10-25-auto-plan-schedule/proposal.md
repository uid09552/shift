# Proposal

## Why

Every roster starts with a planner opening the Scheduler, choosing a period,
waiting for the solver and pressing *Take as Plan*. The steps are always the
same, so the planning is easy to forget until a month is already due
(`publish_lead_days`). Planners want the system to do the routine part on its
own, on a rhythm they set, and only call them in when a plan needs a human.

## What Changes

- **A schedule in the planner settings.** A new *Automatic planning* section,
  off by default: run **every N weeks, on a weekday, at a time**, counted from a
  start date, and plan **a chosen range ahead**: 2, 4, 6, 8 or 12 weeks, or 1, 2
  or 3 months. The settings page shows the next run and what the last run did.
- **A background job** checks every tenant's schedule once a minute and, once
  per run day, plans exactly as a planner's run would: same data, the tenant's
  planner settings, labor law included. The run appears in the Scheduler's
  *Runs* tab, marked *automatic*, and in the audit log as `auto-planner`.
- **Where the range starts.** The day after the last day that already has a
  shift in the confirmed roster (at least tomorrow), and it ends the chosen
  range after the run day. Runs join up without gaps or overlaps, a missed run
  is caught up by the next, and a roster that already reaches far enough is left
  alone ("already planned until …").
- **Automatic take-over, only when it is safe.** When the solver finishes, the
  plan becomes the confirmed roster only if all of these hold:
  - the solver reports nothing to flag (status optimal or feasible, no short
    slots, nothing dropped, no personal limit exceeded);
  - every month it touches is `draft`, so no change notice and no published or
    locked day is involved;
  - it puts nobody on a day a person has recorded as absent.

  Otherwise it stays a proposal in the Runs tab, with the reason on the
  settings page. It never publishes a month and never overwrites an entry a
  person made.
- **Planning results are now stored for the tenant that asked.** Today the
  result of any plan run is filed under the server's default tenant, so a
  second tenant's run never completes. A schedule that runs for every tenant
  needs this fixed first. (A **fix** to existing behaviour, not only a
  prerequisite.)

Non-goals:

- Publishing or locking months automatically, and notifying people by e-mail or
  push. The outcome is visible on the settings page, the Runs tab and the audit
  log.
- Running the agent's plan check unattended. It needs a signed-in user's token;
  the solver's own report decides, and a planner can still run *Check & fix* on
  any stored proposal.
- Telling the solver about absences recorded by hand (sick, day off, holiday).
  A plan that collides with one stays a proposal; feeding them to the solver is
  a follow-up.
- A "run now" button, and time zones per tenant (the schedule uses the server's
  local time, as the roster rules do).

## Capabilities

### New Capabilities
- `automatic-planning`: The tenant's schedule for planning on its own, the range
  it plans, how the range is chosen, when the result becomes the confirmed
  roster, and what is reported about each run.

### Modified Capabilities
- `shift-optimization`: A planning result is stored for the tenant that
  requested it.

## Impact

- **Backend:**
  - `planner_settings` and `planning_tasks` get new columns, in a new migration.
  - The planner settings API gains the schedule fields and read-only status
    fields.
  - A new job module, `services/auto_plan.rs`, is started in `main.rs` beside
    `wish_schedule`.
  - `services/optimizer.rs`: the result subscriber finds the task's tenant and
    calls the automatic take-over for automatic runs; `take_as_plan` shares its
    plan-to-roster conversion with the job.
  - A new repository method writes an automatic plan without touching manual
    entries.
- **API:** `GET/PUT /planner-settings` (new fields) and the planning task list
  (a `source`), documented in `api/openapi.yaml`.
- **UI:** a new section in the planner settings page, an *Automatic* badge in
  the Runs tab, translations in `de.ts` / `en.ts`.
- **Data:** nothing changes on upgrade, since the schedule is off by default.
  The migration is additive.
- **Other services:** none. The planner and agent are used as they are.
