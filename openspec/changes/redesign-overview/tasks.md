# Tasks

## 1. Shell and role split

- [x] 1.1 Rename `pages/dashboard/ecommerce/` to `pages/dashboard/overview/` with `OverviewComponent` (selector `app-overview`), point the `/` route in `app.routes.ts` at it, and keep `data-testid="overview-page"`; verify `npm run build` passes and `/` still renders
- [x] 1.2 Make `OverviewComponent` resolve the role once through `UserService` and render `<app-planner-overview>` for planner/admin and `<app-viewer-overview>` otherwise (empty stubs for now); verify with a component spec that each role gets the right child and only that one
- [x] 1.3 Delete the metric tiles, the planned-hours chart and the ApexCharts import from the overview; verify a grep for `metric-employees` and `overview-planned-hours` in `ui/src` finds nothing

## 2. Schedule deep link

- [x] 2.1 Accept `?date=YYYY-MM-DD` in `KalenderComponent.ngOnInit` (Day view on that date; an invalid value is ignored), next to the `?month=` handling; verify with a spec that `?date=2026-11-05` opens the Day view anchored on 5 November and `?date=junk` opens the week

## 3. Planner overview: Needs-you

- [x] 3.1 Build the Needs-you list in `PlannerOverviewComponent` from `pending-count`, `roster-change-notices?acknowledged=false&from_date=<today>`, `roster-months` and `planner-settings`, with items for swaps (`/kalender?swaps=open`), unacknowledged changes (`/changes`), each due/overdue draft month (`/kalender?month=YYYY-MM`) and an automatic run whose outcome is `kept_as_proposal` or `failed` (`/scheduler?tab=runs`, with date and note); verify with specs for each item appearing, zero-count items hidden, and `taken_over`/`skipped` showing no run item
- [x] 3.2 Show "nothing waiting" only when all four requests answered with nothing open, and "could not be loaded" on the item whose request failed; verify with a spec where one request errors and the empty state is not shown
- [x] 3.3 Stop rendering `PublishDeadlineBannerComponent` on the overview (the Schedule page keeps it); verify the banner's own spec still passes and the overview spec finds no banner

## 4. Planner overview: coverage grid

- [x] 4.1 Load `/analysis/roster-facts` for today..today+6 and compute cells with `coverage()` from `pages/reports/analytics/model/coverage.ts`; a day/shift is short when its shift cell or any workstation cell under it is short; verify with a spec on a fixture where the day shift is full and the night is short by one, and one where a closed workstation's minimum is ignored
- [ ] 4.2 Render the days × shifts grid: staffed/min in each cell's accessible name, short cells marked with an icon and text as well as colour, short cells and day headers linking to `/kalender?date=…`, testids `overview-coverage-grid` and `coverage-cell-<date>-<shift>`; verify with a spec on the link targets and accessible names, and check light/dark and phone width in the running app
- [x] 4.3 Remove the old today-only coverage card and its `confirmed-shift-plans`/closures computation; verify a grep for `coverage-working` in `ui/src` finds nothing

## 5. Planner overview: layout and lower sections

- [ ] 5.1 Lay out the planner part: Needs-you in full width, then the grid (lg: 8 columns) and My Day (lg: 4 columns), then latest run and recent activity side by side, keeping `overview-my-day`, `overview-latest-run` and `overview-activity`; verify in the running app at desktop and phone width
- [x] 5.2 Translate the latest run's leftover English literals ("Run the optimizer →", "View in Scheduler →", the status labels and relative times) through `en.ts`/`de.ts`; verify the page in German shows no English text

## 6. Viewer overview

- [x] 6.1 Build `ViewerOverviewComponent` with My Day and the viewer's unacknowledged changes (`RosterService.listNotices({ acknowledged: false })`, newest first, acknowledge in place, then refresh the header bell's count); verify with a spec that acknowledging removes the row and triggers the bell refresh, plus an empty-state spec
- [x] 6.2 Add the viewer's open swaps (`ShiftSwapService`, pending statuses, the ones awaiting the viewer first, linking to `/kalender?swaps=open`, hidden when none); verify with a spec on ordering and on the hidden state
- [x] 6.3 Add the wish window section from `GET /wish-settings` (shown while open; says which dates wishes can be placed for, and the scheduled closing time when there is one; links to `/employee-calendar`; hidden while disabled or when the range lies in the past); verify with specs for `enabled`, `enabled` with a scheduled close, `date_range` (current and past) and `disabled`
- [x] 6.4 Assert in a spec, with `HttpTestingController`, that the viewer overview makes no request to `/audit-logs`, `/planner/tasks`, `/analysis/roster-facts`, `/shift-swaps/pending-count` or `/planner-settings`; verify the spec passes
- [x] 6.5 Give every viewer section its own loading and error state; verify with a spec where the notices request fails and My Day, swaps and wishes still render

## 7. Strings, docs and e2e

- [x] 7.1 Add every new string to `shared/i18n/en.ts` and `de.ts` and remove the `dashboard.*` keys no longer used; verify `npm run build` passes and a grep for each removed key finds no usage
- [x] 7.2 Rewrite "Reading the dashboard" in `docs/knowledge/guide/signing-in.md`, the dashboard section of `docs/guide/calendars.md` and "the dashboard explained" in `docs/guide/first-steps.md` for the two overviews; verify `mkdocs build --strict` passes and the `first-steps.md#the-dashboard-explained` anchor still resolves
- [x] 7.3 Update `e2e/resources/pages/overview_page.resource` and `e2e/tests/overview/overview.robot`: drop the tile and chart tests, add Needs-you, coverage grid (a short cell opens the Schedule on its day) and lower-section tests; verify `cd e2e && make dryrun` passes
- [ ] 7.4 Add a viewer case to `e2e/tests/overview/overview_roles.robot` (viewer sees My Day, changes and wish sections, and no Needs-you or grid); verify `make dryrun` passes and, against a running stack, `make e2e ARGS="--include overview"` passes

## 8. Integration check

- [ ] 8.1 Against a running stack, sign in as admin, planner and viewer, and check each overview against the spec scenarios, including a short night cell opening the Day view, and a viewer acknowledging a change with the bell dropping; record the result in the change's PR description

## Workflow follow-up

- Open a separate change to restrict `GET /audit-logs` and `GET /planner/tasks` (and the Audit log menu entry) to planners and admins.
- Archive this change once it is merged.
