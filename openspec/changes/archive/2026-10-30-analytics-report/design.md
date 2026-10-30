# Design

## Context

See proposal.md for the motivation and specs/ for the behaviour.

Relevant current state:

- **Charts and graphs.** The UI uses ApexCharts only on the dashboard, and d3
  (force, drag, zoom) on the lazy-loaded network page under Reports
  (`writerGuard`, `plannerOnly` in the sidebar). Angular 22, standalone
  components, Tailwind, the `t` translation pipe, `LoadErrorComponent` for
  failed loads. `ThemeService.theme$` switches light and dark mode. The
  initial-bundle budget is 4 MB warning / 5 MB error.
- **Existing analysis endpoints.** `src/repository/analysisrepository.rs`
  already counts what the report needs and has the helpers:
  - `shift_hours`: gross hours, with overnight shifts handled;
  - `weekday_of`: a holiday counts as Sunday (weekday 6);
  - `weekend_saturday`, and night detection;
  - `effective_weekly_hours` / `period_target_hours`.

  `GET /analysis/fairness` caps the period at 366 days.
- **History.** `confirmed_shift_plans` rows are overwritten in place, so
  history is past dates plus:
  - `roster_change_notices`: before/after, source, actor, reason, ack;
  - `audit_logs`: free-text `changes`; can be large;
  - `planning_tasks`: status, source, timestamps, `result_id`.
- **Automatic planning outcomes.** Each automatic run records an audit entry
  `planner.auto_result`, with `entity_id` = task id and `changes.outcome` ∈
  {`taken_over`, `kept_as_proposal`}.
- **Staffing minimums.** The agent's plan check
  (`agent/shift_agent/agent/validation.py`, the staffing check) is the
  reference for how they count:
  - **per shift:** per (day, shift), using the shift's weekday time for
    `weekday_of(day)`. The minimum applies only if a workstation running that
    shift is open that day.
  - **per workstation:** per (day, shift, workstation) for every shift in the
    workstation's `active_shift_ids`, skipped while the workstation is closed.
    `min_employees` defaults to 1 when null.
- **Audit log URL filters.** The Audit log page already reads `from`, `to`,
  `action`, `entity_type`, `entity_id` and `actor` from the URL.

## Goals / Non-Goals

**Goals:**
- Interactive filtering with no server round trip per click on a year of one
  ward's roster.
- Numbers that agree with the Fairness page and the plan check, because they
  come from the same rules.
- No growth of the initial bundle. The report's code and ECharts load only
  with the page.

**Non-Goals:**
- A generic BI engine (user-defined measures, pivots, saved reports).
- Multi-tenant or cross-ward comparisons.
- Pre-aggregated tables or materialised views. Volumes do not need them yet
  (see Risks).

## Decisions

### 1. Apache ECharts, modular, through a small in-house directive

Import from `echarts/core` with only what is used:

- **charts:** `BarChart`, `LineChart`, `HeatmapChart`, `PieChart`,
  `BoxplotChart`, `ScatterChart`;
- **components:** `GridComponent`, `CalendarComponent`,
  `VisualMapComponent`, `TooltipComponent`, `LegendComponent`,
  `DataZoomComponent`, `ToolboxComponent` (saveAsImage),
  `TitleComponent`, `AriaComponent`;
- **renderer:** `CanvasRenderer`.

A standalone `EChartDirective` (`[appEChart]="option"`) owns the instance:

- it inits on the element and resizes with a `ResizeObserver`;
- it disposes on destroy;
- it emits `chartClick` with `{seriesName, name, data, dataIndex}`;
- on a `ThemeService.theme$` change, it disposes and re-inits with the
  registered `shift-light` / `shift-dark` theme, built from the app's Tailwind
  palette. The option is kept, so no data is refetched.

Why not the alternatives:

- **ngx-echarts.** Its releases lag Angular majors (the app is on Angular 22).
  The wrapper we need is about 80 lines.
- **Plotly.js.** About 1 MB even as the cartesian partial bundle. It has no
  calendar heatmap. Linking charts is manual, and its styling is further from
  the app.
- **ApexCharts.** Already here, but weak at cross-filtering, has no calendar
  heatmap, and is slower with 10k+ points.
- **Perspective.** A multi-MB wasm engine with its own UI. That is self-service
  pivoting, which is out of scope.

### 2. Facts from the server, aggregation in the browser

The server returns *facts*. Pure TypeScript functions in
`pages/reports/analytics/model/` filter and aggregate them. Every click
re-aggregates in memory.

- **Scale.** 150 employees × 366 days ≈ 55k roster rows at most per tenant. One
  pass over that takes milliseconds, so cross-filtering needs no round trips.
- **Exception: audit.** Audit entries are unbounded and only counted, so
  `audit-activity` aggregates in SQL (`GROUP BY date, action, entity_type,
  actor`). Rows stay on `/audit-logs`, which the drill-through opens.
- **Alternative considered:** one server aggregate per chart. Every filter
  change becomes N requests, there are more endpoints to keep consistent, and
  cross-filtering gets sluggish. Rejected.

### 3. A compact, column-oriented payload for roster facts

`roster-facts` returns dictionaries plus parallel arrays:

```
{ from_date, to_date,
  dims: { employees:[{id,name,capabilities,weekly_hours}],
          shifts:[{id,name,short_name,color,is_night,
                   weekday:[{weekday,min,max}]}],
          workstations:[{id,name,active_shift_ids,min,max,closures:[{from,to}]}],
          months:[{month,status}], holidays:[date] },
  rows: { date:[...], employee:[idx], shift:[idx|null], workstation:[idx|null],
          present:[bool], absence:[str|null], creation:[str],
          hours:[num], night:[bool], weekend:[date|null], holiday:[bool] } }
```

Indexes point into `dims`. This is about 5× smaller than row objects
(estimated: 55k rows ≈ 1.5 MB raw, ≈ 200 KB gzipped). The client turns it into
typed arrays once.

`weekend` is the Saturday of the weekend the day belongs to (null on a
weekday), not a flag: the Fairness report counts distinct weekends, and that
needs to know which weekend. `hours`, `night`, `weekend` and `holiday` are
computed with the *same*
functions `get_fairness` uses. Those functions move from closures inside
`get_fairness` into module-level helpers, so the two stay identical by
construction.

The other facts (change notices, planning runs) are small and stay row
objects.

### 4. Staffing coverage is computed in the browser, following the plan check

`model/coverage.ts` ports the staffing check's counting rules from Context. It
uses `dims.shifts[].weekday`, `dims.workstations[]` with closures, and
`holidays` (a holiday counts as Sunday).

A shared fixture (`ui/.../model/coverage.fixture.json`) is asserted by an
Angular spec. A second test in `agent/tests/` feeds the same fixture to the
plan check and asserts the same shortfalls. The rule then has one definition
in prose and two tests that pin the ports together.

### 5. Planning runs, with the automatic outcome from the audit log

`planning-runs` selects `planning_tasks` in the period and left-joins:

- `optimized_shift_results`, reading only `result->>'status'`,
  `result->'planning_period'` and `coalesce(result->>'message','') <> ''`.
  It never returns the plan.
- the latest `audit_logs` row with `action = 'planner.auto_result'` and
  `entity_id = task.id::text`, which gives `taken_as_roster`.

A column on `planning_tasks` would be cleaner, but it needs a migration and a
backfill. The audit entry already exists for every automatic run since the
feature shipped.

### 6. Filter state in a signal store, mirrored to the URL

`AnalyticsStateService` holds:

- `period`, `filters` (dimension → set of ids), `selections` (an ordered list
  of `{dim, value}`), `tab` and `search`, all as signals;
- computed views per tab.

It serialises to short query params, for example
`?p=last3m&ws=<id>,<id>&sel=day:2026-03-14&tab=coverage`. It writes with
`replaceUrl: true`, so filtering doesn't flood the history, and it reads the
params on load.

**Cross-filter rule:** a chart is filtered by every selection *except those on
its own dimension*. The clicked chart keeps showing its other categories, with
the selected one emphasised, which is the usual Power BI behaviour. Facts are
refetched only when the period changes. Every other change re-aggregates.

### 7. Page structure

- **Route.** `/analytics` is lazy (`loadComponent`), with `writerGuard`,
  `data: { listPath: '/' }`, and a title key.
- **Sidebar.** The Reports group gets a `plannerOnly` entry.
- **Layout:**
  - a sticky filter bar: period presets, multi-select dropdowns, chips,
    "clear all";
  - KPI tiles per tab, e.g. coverage % or unacknowledged notices;
  - two or three charts per tab;
  - the shared `DetailTableComponent`: sortable, client-side paging (50
    rows), debounced text search, CSV export.
- **Loading.** Each tab component reads only the facts it needs. Roster facts
  load once per period and serve tabs 1–3. Change, audit and planning facts
  load when their tab is first opened.
- **CSV.** RFC 4180 quoting, UTF-8 with BOM so Excel opens umlauts correctly,
  and header names from translation keys.
- **Accessibility.** ECharts' `aria` is on. A visually hidden `<p>` per chart
  gives the key figures, e.g. "12 of 92 days short; worst: 14 March, 3
  missing".

### 8. Backend shape

Four handlers in `AnalysisService`. Each:

- first checks `roles.can_write()`, else returns `AppError::Forbidden`;
- parses the period with a shared `parse_period(q, 366)` helper, extracted
  from `get_fairness`.

The queries live in `analysisrepository.rs`, filtered by `tenant_id` like the
existing ones.

`roster-facts` explicitly selects only the employee columns the spec allows.
A Rust test asserts the serialised dimension has exactly the allowed keys, so
a later column added to `employees` cannot leak.

## Risks / Trade-offs

- **[Large tenants make roster facts heavy]** → It is capped at 366 days and
  column-oriented. The gateway gzips it. If a tenant passes about 500
  employees, add server-side pre-aggregation behind the same tab components.
  The model functions are the seam.
- **[Two ports of the staffing rules drift]** → The shared fixture is tested on
  both sides (Decision 4).
- **[The audit `changes` column is free text]** → The report only counts by
  action, type and actor. It never parses `changes`, except the
  `planner.auto_result` outcome, which is JSON written by our own code.
- **[ECharts adds about 350 KB gzipped]** → Only in the lazy chunk. The initial
  budget is unaffected; task 2.1 checks this.
- **[Rename of the network page in flight]** → Both touch the sidebar Reports
  group and `app.routes.ts`. Whichever lands second resolves a one-line
  conflict. The Analytics entry doesn't depend on the network page's name.
- **[Reasons in change facts are free text and may contain health details]** →
  The same audience (planner, admin) already reads them on the Changes page.
  The report never shows them to viewers, and the CSV carries them only when
  that column is visible.

## Migration Plan

- Additive. No database migration; new read-only endpoints; a new lazy route.
  To roll back, remove the route and the sidebar entry. The endpoints are
  harmless if left in place.
- The MCP server picks up the four new operations from `openapi.yaml` on its
  next start.
