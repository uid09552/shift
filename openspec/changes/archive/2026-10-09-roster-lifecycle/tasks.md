# Tasks

## 1. Data model and settings

- [x] 1.1 Add migration `add_roster_lifecycle`. It creates `roster_months` and `roster_change_notices` (design §1, §4), adds `publish_lead_days`, `freeze_days` and `change_weight` to `planner_settings`, and seeds existing months as `published`, or `locked` for past months. Verify that `diesel migration run` followed by `redo` succeeds and that `src/schema.rs` is regenerated.
- [x] 1.2 Add the models `RosterMonth` and `RosterChangeNotice` with their repository traits in `repository/domain.rs` and implementations. Verify with a repository test against the test DB in `tests/common`.
- [x] 1.3 Extend the planner settings model, service and validation with the three new fields. Verify that `tests/planner_settings.rs` round-trips them and rejects negatives.

## 2. Month status and roster guard

- [x] 2.1 Implement the effective-status computation: no row means draft, and a past published month that is not `reopened` reads as locked. Verify with unit tests for each case in the *Month status* and *Automatic locking* scenarios.
- [x] 2.2 Implement `services/roster_guard.rs`, covering roles × status × freeze window × reason (design §2). Add `AppError::ReasonRequired`, which maps to 428 with `code: reason_required`, and the reading of the `X-Change-Reason` and `X-Change-Source` headers. Verify with unit tests for every *Editing by status* and *Freeze window* scenario.
- [x] 2.3 Add the `/roster-months` endpoints: list with deadline state, publish, and the admin-only unpublish, unlock and lock with a reason, each writing an audit entry. Verify with a new `tests/roster_months.rs` covering the *Publishing*, *Reverting a status* and *Publish deadline* scenarios.

## 3. Guarded roster writes and change notices

- [x] 3.1 Add a required `RosterChangeCtx` to the write methods of `ConfirmedShiftPlanRepository`. In tracked mode they diff the rows and insert notices in the same transaction, after `FOR SHARE` on `roster_months`. Verify with a repository test: an edit in a published month creates exactly one notice, an identical write creates none, and a draft edit creates none.
- [x] 3.2 Make the manual create, update and delete endpoints in `services/confirmed_shift_plan.rs` call the guard. Verify in `tests/roster_lifecycle.rs`: a planner editing a locked month gets 403, a freeze-window edit without a reason gets 428, and the same edit with a reason gets 200 plus a notice.
- [x] 3.3 Route `take_as_plan` through the guard and notices, with the source `take_as_plan`. Add a dry-run diff count to its response for the confirm dialog. Verify with a test that re-taking a plan with 3 differing days yields 3 notices, and that a period touching a locked month is refused.
- [x] 3.4 Make `unavailability.rs` call the guard before creating anything. A refusal fails the whole request, and the absence mirror records source `absence`. Verify with a test that the unavailability and the roster row are never left out of step.
- [x] 3.5 Add the guard and notice helper to `approve_swap`, and refuse swap requests on shifts in non-published months. Verify by extending `tests/shift_swaps.rs` with the three new *shift-swaps* scenarios and with notices for both employees.
- [x] 3.6 Add the viewer filter for draft months to the confirmed-plan read endpoints. Verify with tests that a viewer sees no draft-month rows while a planner does.

## 4. Change notice endpoints

- [x] 4.1 Add `/roster-change-notices` (list, unread-count, acknowledge) and add `roster-change-notices` to `SELF_SERVICE_SEGMENTS`. The handler resolves the caller's employee by email. Verify with tests for the *Own notices*, *Acknowledging* and *Planner overview* scenarios, including a refusal to acknowledge someone else's notice.
- [x] 4.2 Document the new endpoints, the `X-Change-Reason` and `X-Change-Source` headers, the 428 response and the new settings in `api/openapi.yaml`, and update the API and domain overview in `CLAUDE.md`. Verify that the OpenAPI file still validates (`npx @redocly/cli lint api/openapi.yaml`, or the repo's existing check).

## 5. Optimizer stability

- [x] 5.1 Add `published_roster` (published and locked days in the period) to `build_task_dto`, and `change_weight` to the constraints built from settings. Verify with a unit test in `services/optimizer.rs` that a draft-only period sends none.
- [x] 5.2 Planner: add `PublishedShift` and `change_weight` to `models.py`. Add the change variables and penalty, and the published-roster hint for phase 1, in `optimizer.py`, and output `changes_vs_published`. Verify with a new `planner/tests/test_published.py`: one sick day changes only what coverage needs, weight 0 ignores the roster, and the change count is correct.
- [x] 5.3 Agent: confirm that the `resolve` repair and `optimizeSchedule` pass `published_roster` through from prepare, and add the change count to plan validation output. Verify with a test in `agent/tests/` that runs resolve against a published period.
- [x] 5.4 Document `published_roster`, `change_weight` and `changes_vs_published` in `planner/README.md` and in the optimizer section of `CLAUDE.md`. Verify that the README example input still runs (`cd planner && make schedule`).

## 6. UI

- [x] 6.1 Add a reason-required HTTP interceptor and reason dialog: on a 428 it asks for a reason and retries with `X-Change-Reason`. The replacement flow sends `X-Change-Source: replacement`. Verify by hand in a published month by editing tomorrow's shift on the Schedule page, then confirm the notice exists.
- [x] 6.2 On the Schedule page, add a month status badge with Publish (planner) and Unpublish, Unlock and Lock (admin, with a reason), and a confirm dialog for Take as Plan into a published month that shows the change count. Verify by hand and with a Robot e2e smoke test using `data-testid` locators.
- [x] 6.3 Show a deadline warning on the dashboard for due and overdue draft months. Verify that it appears for a draft month inside `publish_lead_days` and disappears once the month is published.
- [x] 6.4 Add a "Changes to my shifts" page with an acknowledge action, and add the notice count to the header bell for every role. Add a planner view of unacknowledged notices. Verify by hand with a viewer and a planner account.
- [x] 6.5 Add `publish_lead_days`, `freeze_days` and `change_weight` to the Planner settings page. Verify that they save and reload.

## 7. Integration check

- [ ] 7.1 Run the whole flow on the dev stack. Plan October, publish it, log in as a viewer to see it, mark someone sick with a reason inside the freeze window, re-solve, and confirm that only a few changes result. Take the result as plan, and check that the affected viewers see notices and can acknowledge them. Verify that `make test`, `cd planner && make test` (or pytest), the agent tests and `make e2e ARGS="--include smoke"` all pass.
