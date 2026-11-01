# Design

## Context

The overview is `EcommerceComponent` (`ui/src/app/pages/dashboard/ecommerce/`),
mounted at `/` for every role. It already embeds `MyDayComponent` and
`PublishDeadlineBannerComponent`, and loads its other sections itself.

Facts about what exists today:

- **Role checks in the UI**: `UserService` has `hasRole`, a planner-or-admin check and `isAdmin`.
- **Planner-only data**:
  - `GET /analysis/roster-facts` refuses viewers.
  - `GET /shift-swaps/pending-count` counts `pending_planner` swaps and refuses viewers.
- **Data scoped to the caller for a viewer**: `GET /shift-swaps` and
  `GET /roster-change-notices` return only the viewer's own entries.
  `POST /roster-change-notices/acknowledge` is own-only.
- **Data any role may read**:
  - `GET /planner-settings` carries `auto_plan_last_run_on`, `auto_plan_last_outcome`
    (`running`, `taken_over`, `kept_as_proposal`, `skipped` or `failed`) and `auto_plan_last_note`.
  - `GET /wish-settings` carries the wish window.
  - `GET /roster-months` carries month status and due/overdue.
- **Coverage counting**: `pages/reports/analytics/model/coverage.ts` implements the
  rule set the agent's staffing check uses, pinned by a fixture both sides run. The
  current overview counts its own way instead.
- **Schedule deep links**: `/kalender` accepts `?view=`, `?month=YYYY-MM` and
  `?swaps=open`, but has no way to open on a given day.

## Goals / Non-Goals

**Goals:**
- One overview route. The role decides which part is rendered, and only that part's requests are made.
- Coverage that cannot disagree with *Verify Plan* or the Analytics report.
- Every Needs-you item is a link to the place where it is handled.

**Non-Goals:**
- Any backend change. Restricting `/audit-logs` and `/planner/tasks` for viewers is
  left to a separate change; see proposal Impact.
- Live updates. The page loads once per visit, as it does now.
- Making My Day different for each role.

## Decisions

**1. A thin shell component with two child components.**
`OverviewComponent` (at `/`) resolves the role once and renders `<app-planner-overview>`
or `<app-viewer-overview>`. Each child does its own requests in `ngOnInit`. A role
switch inside one component, guarded with `@if`, would also work. But a child that
is never instantiated cannot make a request, which makes "the viewer overview makes no
ward-level request" true by construction and easy to test (instantiate the viewer
part, assert no `HttpTestingController` match).
*Alternative*: two routes with guards. Rejected because `/` would need a redirect, and
bookmarks and the analytics redirect both target `/`.

**2. Reuse the analytics coverage model, read from roster facts.**
The grid calls `GET /analysis/roster-facts` for today..today+6 and runs `coverage()`
from `model/coverage.ts` (plus `facts.ts` for indexing). It shows the shift-level
cells per day, and marks a day/shift short if its shift cell, or any workstation cell
under it, is short. The tooltip/accessible name lists the short workstations.
*Alternative*: keep the existing `confirmed-shift-plans` + workstations computation.
Rejected because it is the disagreement this change exists to remove.
*Alternative*: a new `/overview` backend endpoint. Rejected because the model already
exists and a second implementation of the rules would need its own fixture.
The model files are imported from `pages/reports/analytics/model/`. They import only
each other and the `RosterFactsPayload` type, so no ECharts or analytics state comes
along. If a later change wants them shared, moving them is a separate refactor.

**3. Needs-you is built from four independent requests.**
- `pending-count` gives the swaps item.
- `roster-change-notices?acknowledged=false&from_date=<today>` gives the notices count.
  The list endpoint has no total, so the count is the list's length.
- `roster-months` (current month + 3) gives the due/overdue months.
- `planner-settings` gives the auto-run item.

Each request fills its own item. A failed one shows "could not be loaded" for that item
alone, so the list never claims "nothing waiting" while it is missing data: the empty
state needs all four answers. The page's `PublishDeadlineBannerComponent` is dropped.
The Schedule page keeps its own banner.

**4. The auto-run item follows the stored outcome, nothing more.**
It shows while `auto_plan_last_outcome` is `kept_as_proposal` or `failed`, and
disappears when the next run writes a new outcome. We do not try to detect that a
planner has since taken or discarded that proposal, because nothing records that link
today.

**5. `?date=YYYY-MM-DD` on the Schedule.**
It opens the Day view on that date. It is added next to the existing `?month=`
handling in `KalenderComponent.ngOnInit`. Short grid cells and day headers link to it.

**6. Viewer sections reuse existing services and components.**
- Changes use `RosterService.listNotices({ acknowledged: false })` and `acknowledge`.
  After an acknowledgement, the header bell's count is refreshed through whatever
  the bell already listens to; if it only polls, it is told to reload.
- Swaps use `ShiftSwapService.list` with the pending statuses. Swaps awaiting the
  viewer (they are the colleague, status `pending_colleague`) come first, and each links to `/kalender?swaps=open`.
- The wish window comes from `GET /wish-settings`. The section links to `/employee-calendar`.
  `date_range` bounds the dates a wish may be placed *for* (`allows_wish_on`), not a
  deadline. A deadline exists only when the schedule's `next_change_at` will close the window
  (`next_change_opens === false`).

**7. Layout.**
Planners:
- Row 1 is Needs-you (full width).
- Row 2 has the coverage grid (lg: 8 columns) and My Day (lg: 4 columns).
- Row 3 has latest run and recent activity, side by side and visually quieter.

Viewers: My Day full width, then changes, swaps and wishes in one column. On mobile
everything stacks in source order. The cards keep the existing `rounded-2xl border` style
so the page matches the rest of the app. `data-testid`s are kept where a section
survives (`overview-page`, `overview-my-day`, `overview-latest-run`, `overview-activity`)
and new ones are added for the new sections (`overview-needs-you`, `needs-you-item-<kind>`,
`overview-coverage-grid`, `coverage-cell-<date>-<shift>`, `overview-my-changes`,
`overview-my-swaps`, `overview-wish-window`).

## Risks / Trade-offs

- **Roster facts can be large.** The response carries dimensions plus rows for 7 days,
  which is small next to the Analytics page's month-to-year range. The 7-day window is
  fixed, so the response cannot grow beyond that.
- **The auto-run item can go stale.** A planner who has already handled the proposal still
  sees the item until the next run. The item states the run date and outcome, never "action
  required", so it reads as information. A later change can tie it to the task's Take as Plan.
- **Removing the tiles and chart breaks existing e2e tests.** Those tests are replaced in
  the same change, and the overview page object drops their keywords.
- **Viewers can still read audit logs through the API and the Audit log page.** This change
  does not make that worse, and the follow-up is named in the proposal.

## Migration Plan

UI-only, so it deploys with the UI image. Rolling back means reverting the UI. There is no data or API to migrate.
