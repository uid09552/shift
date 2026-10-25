# Tasks

## 1. Settings

- [x] 1.1 Add migration `00000000000037_auto_plan` (up and down): the twelve `auto_plan_*` columns on `planner_settings` with the defaults of design decision 1 and `planning_tasks.source` (default `manual`); update `src/schema.rs`; verify the migration runs on an empty database, that `diesel migration redo` round-trips, and that `cargo test --test weekly_hours --test planner_settings` still passes
- [x] 1.2 Carry the fields through `PlannerSettings` / `UpdatePlannerSettings` and the planner-settings repository, with `auto_plan_armed_at` set only when the enabled flag or a schedule field actually changes; verify with a repository test that an unrelated settings change leaves `armed_at` alone
- [x] 1.3 Extend the planner-settings service: accept the schedule fields and validate them (interval 1–12, weekday 0–6, `HH:MM`, a start date while enabled, range unit/count one of the eight presets), return the read-only status fields and a computed `auto_plan_next_run`, and ignore the status fields on `PUT`; verify with integration tests in `tests/auto_plan.rs`: off by default, a valid schedule round-trips, each invalid value is a 400 that changes nothing, a viewer is refused, and a `PUT` carrying status fields does not move them
- [x] 1.4 Document the new fields, the presets and the status fields in `api/openapi.yaml`; verify the YAML parses and every `$ref` resolves

## 2. Results belong to the tenant that asked

- [x] 2.1 Add `PlanningTaskRepository::find_planning_task(id)` (no tenant argument, returns the task with its tenant), make `handle_result_message` use that tenant for storing the result and updating the task (the default tenant only when the task is not found), pass a `source` through `OptimizerService::schedule` into `planning_tasks.source`, and carry it onto `TaskResultDto.source`; verify with integration tests that a second tenant's plan result and a second tenant's solver error each complete or fail that tenant's task, appear in that tenant's lists, and are invisible to the default tenant
- [x] 2.2 Add `source` to the planning task and result responses in `api/openapi.yaml` and to the UI services' types; verify the YAML parses and `ng build` passes

## 3. When to run and what to plan

- [x] 3.1 Extract the weekly occurrence arithmetic from `WishScheduleDomain::occurs_on` into a shared `weekly_occurrence(start, weekday, interval, date)` and use it from both; verify that the existing `wish_schedule` unit tests pass unchanged and add the "every 2 weeks from Monday 2026-10-05" cases for the new schedule
- [x] 3.2 Add `services/auto_plan.rs` with the pure `is_due(settings, now)` (run day, time reached, not before `armed_at`, not already claimed today, enabled) and unit tests for each spec scenario: every second week, restart the same day, switched on after the time, switched off
- [x] 3.3 Add the pure `plan_window(run_day, range, last_planned)` with unit tests for each spec scenario: roster ends before the range (2026-10-19 to 2026-11-02), empty roster, one month from 2026-01-31 ends 2026-02-28, and "already planned until"
- [x] 3.4 Add the repository methods `last_planned_day(tenant)` (latest confirmed entry with a shift), `claim_auto_plan_run(tenant, day)` (the single conditional `UPDATE` of design decision 2) and `set_auto_plan_outcome(...)`; verify with integration tests that a second claim on the same day is refused, that eight concurrent claims produce exactly one winner, and that `last_planned_day` ignores absences and free days

## 4. Running and taking over

- [x] 4.1 Extract `entries_from_plan` (plan → confirmed entries, plus the closed-workstation check) from `take_as_plan` without changing its behaviour; verify that `cargo test --test roster_lifecycle --test shift_swaps` still passes and `take_as_plan` produces the same entries (a unit test on the extracted function)
- [x] 4.2 Add the pure `decide(result, month_statuses, recorded_absences, closed_workstations, entries)` returning `TakeOver` or `Keep(reason)`, with unit tests for every reason and for the clean case: a non-optimal status, a non-empty `message`, a published month, a locked month, an assignment on a `sick` / `day_off` / `holiday` / `unknown` absence (and none for an `unavailable` mirror), and an assignment on a closed workstation
- [x] 4.3 Add `apply_automated_plan` to the confirmed-shift-plan repository (delete only `creation_type = 'automated'` in the window, insert the plan's entries with `ON CONFLICT DO NOTHING`, all inside `rostertracking::guarded`); verify with integration tests that automatic entries are replaced, that a manual entry on a planned day stays as it was, and that a published month refuses the write and leaves the roster unchanged
- [x] 4.4 Add `start_run` (compute the window, `OptimizerService::schedule` with source `auto` and the tenant's `build_constraints`, write the `running` outcome and the `planner.auto_run` audit entry) and `spawn` (the 60 s tick over enabled tenants, claim, run, and fail runs `running` for over three hours), and start it in `main.rs` beside `wish_schedule`; verify with integration tests that a run without NATS ends as `failed` with the reason and writes no roster entry, that a roster already reaching the end of the range ends as `skipped` with the date, and that two ticks on one day start one run
- [x] 4.5 Add `on_result` / `on_failure` and call them from `handle_result_message` for tasks with source `auto`: decide, take over or keep, write the outcome, note and `planner.auto_result` audit entry; verify with integration tests that feed `handle_result_message` a crafted solver result: a clean plan in draft months is confirmed as automatic entries and the months stay draft; a result with a short slot, a plan into a published month, and a plan on a recorded absence each stay a proposal with the reason in the outcome and the roster untouched; and a solver error is `failed`

## 5. UI

- [x] 5.1 Add the schedule fields and status fields to the planner-settings service types, the range presets (eight options mapped to unit/count) and a pure `nextOccurrence(weekday, from)` helper for the start-date default; verify with unit specs for the presets and the helper
- [x] 5.2 Add the *Automatic planning* section to the planner-settings page (switch; every N weeks on a weekday at a time from a start date; the range dropdown; a status block with next run, last run, outcome, note and a link to the Runs tab; enabling pre-fills the start date), with `de.ts` / `en.ts` strings and `data-testid`s; verify with a component spec that the section saves the right payload, shows the status, and disables the controls while off, and that `ng build` passes
- [x] 5.3 Show an *Automatic* badge on runs and jobs with source `auto` in the Scheduler's Runs tab, and add labels for `planner.auto_run` and `planner.auto_result` to the audit-log page; verify with component specs and `ng build`
- [x] 5.4 Add a Robot case under `e2e/tests/settings/` that switches automatic planning on, sets an interval, weekday and range, saves, reloads and finds them kept, then switches it off again; verify with `cd e2e && make dryrun`

## 6. Integration check

- [x] 6.1 Run `cargo test` for the new and touched suites against a database, `ng test`, `ng build` and `cd e2e && make dryrun`; verify that they pass (the five suites that already fail on a missing token verifier excepted)
- [ ] 6.2 Against a running stack with the planner and NATS: set a schedule for today a few minutes ahead, wait, and confirm the Runs tab lists an automatic run, the settings show its outcome (taken over, or kept as a proposal with a reason), a second tenant's run completes, and nothing is published
