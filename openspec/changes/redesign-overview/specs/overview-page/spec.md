# Spec Delta

## Purpose

The landing page after sign-in. Each role sees what is waiting for them, and what
concerns them, before anything else, and the page loads only data that role may use.

## ADDED Requirements

### Requirement: Role-specific overview
The page at `/` SHALL show the planner overview to `shift-planner` and `shift-admin`,
and the viewer overview to a user whose only shift role is `shift-viewer`. A user with
both shows the planner overview. Neither overview SHALL show a count of employees,
shifts or workstations, or a chart of planned hours.

#### Scenario: Planner signs in
- **WHEN** a planner opens `/`
- **THEN** the page shows the Needs-you list, the coverage grid and My Day

#### Scenario: Viewer signs in
- **WHEN** a viewer opens `/`
- **THEN** the page shows My Day, their changes, their swaps and the wish window, and no Needs-you list or coverage grid

### Requirement: Viewer overview loads no ward-level data
The viewer overview SHALL NOT request the audit log, the planning task list, roster
facts, the planner-only swap count or the planner settings. Every request it makes
SHALL be one the backend answers for a viewer with that viewer's own data, or with
data every role may read.

#### Scenario: Requests made for a viewer
- **WHEN** a viewer opens `/`
- **THEN** no request to `/audit-logs`, `/planner/tasks`, `/analysis/roster-facts`, `/shift-swaps/pending-count` or `/planner-settings` is made

### Requirement: Needs-you list
The planner overview SHALL open with one list of open items. Each item SHALL show a
count or date and SHALL link to the page where it is handled. An item whose count is
zero SHALL NOT be shown. When no item is shown, the list SHALL say that nothing is
waiting.

#### Scenario: Nothing waiting
- **WHEN** no swap awaits approval, no future change is unacknowledged, no month is due and the last automatic run did not stay a proposal or fail
- **THEN** the list shows a single "nothing waiting" line

#### Scenario: One item open
- **WHEN** two swaps await a planner's decision and nothing else is open
- **THEN** the list shows only "2 swaps to approve", linking to the swap requests

### Requirement: Needs-you items
The Needs-you list SHALL offer these items:
- swaps awaiting a planner's decision, linking to the swap requests;
- change notices for today or later that are not acknowledged, linking to the Changes page filtered to unacknowledged;
- each draft month that is due or overdue for publishing, linking to the Schedule on that month;
- the last automatic run, when its outcome is `kept as proposal` or `failed`, with its date and reason, linking to the Scheduler's Runs tab.

#### Scenario: Month due
- **WHEN** December is a draft month 20 days before it starts and `publish_lead_days` is 28
- **THEN** the list shows December as due, with the days left, and the separate publish-deadline banner is not shown on this page

#### Scenario: Automatic run kept as proposal
- **WHEN** the last automatic run's outcome is `kept as proposal` because a slot stayed short
- **THEN** the list shows that run's date and the reason, linking to the Runs tab

#### Scenario: Automatic run taken over
- **WHEN** the last automatic run's outcome is `taken over` or `skipped`
- **THEN** the list shows no automatic-run item

#### Scenario: Old notices
- **WHEN** the only unacknowledged notices are for days before today
- **THEN** the list shows no change-notice item

### Requirement: Coverage grid
The planner overview SHALL show the confirmed roster's staffing for today and the next
six days as a grid of days by shift. Staffing, minimums and shortfalls SHALL be counted
exactly as the Analytics report and the agent's plan check count them: per shift and
per workstation, with holidays using Sunday's bounds and closed workstations skipped.

#### Scenario: Night short behind a full day
- **WHEN** tomorrow's day shift is fully staffed and tomorrow's night shift is one short of its minimum
- **THEN** the grid marks tomorrow's night cell as short by one and the day cell as covered

#### Scenario: Closed workstation
- **WHEN** a workstation is closed tomorrow
- **THEN** its minimum does not make any of tomorrow's cells short

### Requirement: Coverage grid links
Every grid cell SHALL say its staffed count and its minimum in its accessible name. A
cell that is short SHALL be visibly marked, not by colour alone, and SHALL open the
Schedule on that day.

#### Scenario: Open a short day
- **WHEN** a planner activates a short cell for Thursday
- **THEN** the Schedule opens on Thursday

### Requirement: Latest run and recent activity
The planner overview SHALL show the latest planning run, with its status and age, and
the six most recent audit entries, below the Needs-you list, the coverage grid and My
Day. Each SHALL link to its full page.

#### Scenario: Order on the page
- **WHEN** a planner opens `/`
- **THEN** the latest run and recent activity come after the coverage grid and My Day

### Requirement: Viewer's own changes
The viewer overview SHALL list the viewer's own change notices that are not
acknowledged, newest first, each with the day and what changed. The viewer SHALL be
able to acknowledge them from the overview. When none are open, the section SHALL say
so.

#### Scenario: Acknowledge from the overview
- **WHEN** a viewer acknowledges a listed change
- **THEN** it leaves the list and the header bell's count drops by one

### Requirement: Viewer's own swaps
The viewer overview SHALL list the viewer's open swaps: those waiting for the viewer's
answer first, then those waiting on the colleague or a planner. Each SHALL link to the
swap. When none are open, the section SHALL NOT be shown.

#### Scenario: Swap waiting for the viewer
- **WHEN** a colleague offered the viewer a swap that awaits the viewer's answer
- **THEN** it is listed first and marked as waiting for them

### Requirement: Wish window
The viewer overview SHALL show, while wishes can be placed, for which dates they can be
placed (any date, or the window's range) and, when a schedule will close the window,
when it closes. It SHALL link to entering a wish. While the window is disabled, or its
range lies wholly in the past, the section SHALL NOT be shown.

#### Scenario: Window open with a range
- **WHEN** the wish window is `date_range` from 1 to 15 December
- **THEN** the overview says wishes can be placed for 1 to 15 December

#### Scenario: Scheduled close
- **WHEN** the wish window is `enabled` and its schedule closes it on 20 November
- **THEN** the overview says wishes can be placed until 20 November

#### Scenario: Range in the past
- **WHEN** the wish window is `date_range` and its range ended yesterday
- **THEN** no wish section is shown

#### Scenario: Window disabled
- **WHEN** the wish window is `disabled`
- **THEN** no wish section is shown

### Requirement: Sections fail independently
Each section SHALL load on its own. A section whose request fails SHALL say it could not
be loaded, and SHALL NOT stop any other section from showing.

#### Scenario: Roster facts unavailable
- **WHEN** the roster-facts request fails
- **THEN** the coverage grid says it could not be loaded, and the Needs-you list and My Day still show
