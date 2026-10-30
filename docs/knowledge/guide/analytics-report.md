---
type: Task Guide
title: Analysing the Ward with the Analytics Report
description: The Analytics page under Reports — filters, click-to-narrow, the six tabs (coverage heatmap, hours and fairness, absences, roster changes, audit activity, planning runs), CSV and picture export, and how its numbers relate to Verify Plan and the Fairness page.
tags: [user-guide, reports, analytics, coverage, heatmap, fairness, absences, audit, planning-runs, export]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-30T00:00:00Z
sources:
  - resource: docs/guide/calendars.md
    author: human:maxrg
    last_modified: 2026-10-30
  - resource: openspec/changes/analytics-report
    author: human:maxrg
    last_modified: 2026-10-30
---

**Reports → Analytics** answers questions across time rather than about one
day: were we short on nights more often since spring, which workstation runs on
its minimum every weekend, how many published days changed last quarter and
why, who edits the roster most, how often the automatic plan stayed a proposal.
It is for planners and admins; viewers neither see it nor can call its data.
It only reads — nothing on it changes the roster.

# Filters and clicks

One filter bar applies to every chart and the table:

* **Period** — this month, last month, this quarter, last 3 months (the
  default), last 12 months, or custom dates; at most one year.
* **Workstation, shift, employee, capability, absence type, change source** —
  any number of each. A capability filter keeps the people who hold it.

Clicking a chart element — a bar, a slice, a day in the coverage heatmap —
narrows every *other* chart and the table to it and adds a chip. Clicking it
again, or the chip's ×, undoes it; **Clear all** removes every filter and
click. The clicked chart itself keeps showing the alternatives, with the pick
highlighted.

The whole view (period, filters, clicks, tab, table search) lives in the page
address: copying it shares exactly that view.

# The six tabs

| Tab | Shows |
|---|---|
| Staffing & coverage | Head count per day against the summed minimum; a calendar **heatmap** of each day's shortfall; shortfall by shift and by workstation; cells over their maximum. Draft months are shaded. |
| Hours & fairness | Hours against each person's prorated target (weekly hours × days ÷ 7); nights, weekend days and holiday shifts per person and per month; a box plot of the spread across the team. |
| Absences | Absence days by type over time, per weekday, by type and per person. The plan's own *not rostered* day (`free`) is not an absence; a recorded day off is. |
| Roster changes | Change notices (published and locked months only) over time by source — edit, new plan taken, absence, swap, replacement — most-changed people and workstations, who made the changes, the share with a reason, and the time until people read them. |
| Audit activity | Audit entries per day by action, item type and actor. Each table row links to the **Audit log** page filtered to that action, item type, actor and day. |
| Planning runs | Runs over time by source (manual or automatic), how they ended (optimal, feasible, infeasible, failed), how long they took, and how many automatic plans were taken as the roster or kept as a proposal. |

Every tab has KPI tiles on top and, below the charts, a **table** of the rows
behind them: sortable, searchable (names, actions, reasons), and exportable
with **Export CSV** — exactly the rows shown, all pages. Each chart's menu icon
saves it as a PNG.

# How the numbers relate to the rest of the app

* **Shortfalls are counted like Verify Plan.** Per shift: entries on that day
  and shift against the shift's weekday minimum — a public holiday uses the
  Sunday minimum, and the minimum applies only if a workstation running the
  shift is open. Per workstation: entries on that day, shift and workstation
  against the workstation's minimum, skipped while it is closed or
  deactivated. A shared test fixture holds the report and the plan check to the
  same answer.
* **Hours, nights and weekends equal the Fairness page** for the same period
  and people: the backend counts each entry the same way for both, and the
  report only adds them up.
* **Filtering by people** narrows the head count, not the minimum, which is
  the ward's. The Staffing tab says so when such a filter is on.
* **History** is what the database keeps: past confirmed days, change notices,
  audit entries and planning runs. A roster day is overwritten in place, so
  what it looked like *before* a change comes only from change notices and the
  audit log.

# Behind the page

The page reads four planner-only endpoints, each limited to one year and to
the caller's tenant, and aggregates in the browser:

* `GET /analysis/roster-facts` — the confirmed roster as columns plus the
  dimensions (people with capabilities and weekly hours — no e-mail and no
  personal-limit data — shifts with weekday minimums and maximums, workstations
  with closures, month statuses, holidays).
* `GET /analysis/change-facts` — change notices with names resolved.
* `GET /analysis/audit-activity` — audit entries counted per day, action, item
  type and actor (the log itself stays on `GET /audit-logs`).
* `GET /analysis/planning-runs` — tasks with solver status and, for automatic
  runs, whether the plan became the roster; never the plan itself.

They are in the OpenAPI specification, so the assistant can call them too
(`getRosterFacts`, `getChangeFacts`, `getAuditActivity`, `getPlanningRuns`).
