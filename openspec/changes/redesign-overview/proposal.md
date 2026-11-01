# Proposal

## Why

The Overview is the first page every user lands on, but it is still the TailAdmin
"ecommerce" dashboard filled with ward data: setup counts, a planned-hours chart, a
coverage list and the audit trail, the same for every role. It does not answer the
question people open it with. For a planner that question is "what needs me", for a
viewer it is "what is going on with my shifts". The system already knows the answers
(swaps waiting, unread change notices, months due for publishing, an automatic plan
that stayed a proposal, short slots in the coming days), but they are spread over the
bell, the Changes page, the Scheduler and the settings page.

Its coverage card also counts staffing differently from the plan check: per
workstation per day, with no shift dimension. A night that is short can show up as
fully staffed.

## What Changes

- The Overview becomes **role-specific**. Planners and admins see a planner overview.
  Viewers see a personal overview. Neither loads data meant for the other.
- **Planner overview**, in this order:
  - **Needs you**: one list of open items, each with a count and a link to where it is
    handled. The items are swaps awaiting approval, change notices nobody has
    acknowledged, draft months due or overdue for publishing (replacing the separate
    banner on this page), and the last automatic plan run when it stayed a proposal.
    The list says so plainly when nothing is open.
  - **Coverage, next 7 days**: a grid of days by shift. Each cell is counted the way
    the analytics report and the agent's plan check count it. Short cells open the
    Schedule on that day.
  - **My Day**, unchanged.
  - **Latest run** and **Recent activity**, kept below everything else.
- **Viewer overview**:
  - My Day.
  - The viewer's own unacknowledged roster changes, which can be acknowledged in place.
  - The viewer's own open swaps (waiting for them, or waiting on someone else).
  - The wish window when it is open, with its closing date and a link to enter wishes.
- **Removed**: the three metric tiles (employees, shifts, workstations) and the
  "planned hours per day" chart. Both are reachable elsewhere (Configuration, Analytics).
- The component is renamed from `EcommerceComponent` to an overview component; the route `/` stays.
- No new backend endpoint. Every section reads an endpoint that exists today.

## Capabilities

### New Capabilities
- `overview-page`: the landing page after sign-in, meaning what each role sees on it,
  in what order, where each item links, and which data it may load.

### Modified Capabilities
<!-- None. roster-publication already requires the publish deadline "on the
     dashboard"; the planner overview keeps meeting that through the Needs-you list.
     analytics-report's "viewers are redirected to the overview" is unaffected. -->

## Impact

- **UI**:
  - `ui/src/app/pages/dashboard/` gets a rewritten overview plus a planner part and a viewer part.
  - `app.routes.ts` changes the component reference.
  - New strings go in `shared/i18n/en.ts` and `de.ts`.
  - The analytics `model/coverage.ts` is reused, not copied.
- **Backend**: none. Reads `/shift-swaps/pending-count`, `/roster-change-notices`
  (+ `/unread-count`, `/acknowledge`), `/roster-months`, `/planner-settings`,
  `/analysis/roster-facts`, `/shift-swaps`, `/wish-settings`, `/planner/tasks` and
  `/audit-logs`. All of these exist today.
- **E2E**:
  - `e2e/tests/overview/overview.robot` and its page object lose the tile and chart
    tests and gain tests for the new sections.
  - `overview_roles.robot` gains a viewer case.
- **Out of scope**: `GET /audit-logs` and `GET /planner/tasks` answer viewers today, and
  the Audit log page is in a viewer's menu. This change stops the Overview from
  *loading* them for viewers, but does not restrict the endpoints. That needs its own
  change, because it affects the Audit log page too.
