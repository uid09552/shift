# Tasks

## 1. Backend: analytics fact endpoints

- [x] 1.1 Extract `parse_period(q, max_days)` from `get_fairness`, and extract its hours, night, weekend and holiday computation into module-level helpers in `analysisrepository.rs`. Point `get_fairness` at them. Verify that the existing fairness tests pass unchanged (`make test`).
- [x] 1.2 Add `GET /analysis/roster-facts`: the column-oriented rows and dims (design, Decision 3), the per-weekday min/max, closures, month statuses and holidays. The employee dimension selects only the allowed columns. The handler checks `roles.can_write()` and returns `Forbidden` otherwise. Verify with Rust tests:
  - a night on a holiday gives `night` + `holiday` and the same hours as the fairness report;
  - a sick row has zero hours;
  - the Saturday minimum is listed;
  - a viewer gets 403;
  - a range over 366 days is refused;
  - another tenant's rows are absent;
  - the serialised employee keys are exactly the allowed ones.
- [x] 1.3 Add `GET /analysis/change-facts` over `roster_change_notices`, with workstation before/after taken from the `before`/`after` JSON. Verify with Rust tests for an unacknowledged notice, the `replacement` source, a viewer getting 403, and tenant isolation.
- [x] 1.4 Add `GET /analysis/audit-activity`, a SQL `GROUP BY` of day, action, entity type and actor, plus the total. Verify with a Rust test that the group counts sum to the total, and that one group's count equals `list_audit_logs` filtered by the same action, type, actor and day. Also check that `auto-planner` entries appear under that actor.
- [x] 1.5 Add `GET /analysis/planning-runs`: tasks left-joined with the result's status, period and has-message, and with the latest `planner.auto_result` audit entry for `taken_as_roster` (design, Decision 5). Verify with Rust tests for an auto run with a message (`taken_as_roster` false), an auto run taken over, a failed task with no solver status, and that no plan body is returned.
- [x] 1.6 Register the four routes in `src/server.rs` and describe them in `api/openapi.yaml` (operation ids `getRosterFacts`, `getChangeFacts`, `getAuditActivity`, `getPlanningRuns`, with response schemas). Verify that the route/spec path diff used in earlier changes shows no difference, and that the MCP server lists the four tools.

## 2. UI foundation

- [x] 2.1 Add `echarts` to `ui/package.json`. Create `shared/components/charts/echart.directive.ts` with the modular imports and the `shift-light`/`shift-dark` themes, re-initing on `theme$`, a `ResizeObserver`, dispose on destroy, and a `chartClick` output. Verify with a spec that a theme change re-inits with the same option and destroy disposes the instance. Verify with `npm run build` that the initial bundle size is unchanged and ECharts lands only in a lazy chunk.
- [x] 2.2 Add the `/analytics` lazy route with `writerGuard`, and a `plannerOnly` sidebar entry under Reports, with the translation keys `nav.analytics` and `title.analytics` (de, en). Verify that a viewer is redirected and that the planner menu shows the entry, using the existing guard spec pattern.
- [x] 2.3 Extend `analysis.service.ts` with typed calls for the four endpoints, and decode roster facts into typed arrays once. Verify with a spec that decoding a sample payload yields the right row count and that dims resolve by index.
- [x] 2.4 Create `AnalyticsStateService`: period, filters, selections, tab and search as signals; serialise to and from short query params with `replaceUrl`; refetch only on a period change. Verify with specs:
  - a round trip of a full state through the URL;
  - a period change triggers one fetch, while a filter change triggers none.
- [x] 2.5 Write the pure filter model `model/filter.ts`, which applies filters and selections, excluding a chart's own dimension. Verify with specs that a capability filter keeps only holders, and that a selection on the day dimension narrows other charts but not the day chart.
- [x] 2.6 Build the filter bar (presets, custom range capped at one year, multi-selects, chips, clear all) and the `DetailTableComponent` (sort, page of 50, debounced search, CSV with BOM and RFC 4180 quoting). Verify with specs for the CSV quoting of `;`, `"` and umlauts, and for search narrowing the rows. Add `data-testid`s `analytics-filter-*`, `analytics-chip-*` and `analytics-table-*`.
- [x] 2.7 Build the page shell: tabs, KPI tile component, per-tab loading, `LoadErrorComponent` with Retry, and the empty states. Verify with a spec that a failed roster-facts call shows the load error on tabs 1–3 and draws no chart.

## 3. UI analyses

- [x] 3.1 Write `model/coverage.ts`, following the plan check's staffing rules (design, Context and Decision 4), together with `coverage.fixture.json`. Verify with an Angular spec on the fixture: a short Saturday, a closed workstation not counted, a holiday using Sunday rules, and days over the maximum. Add `agent/tests/test_coverage_fixture.py`, which runs the plan check's staffing counting on the same fixture and asserts the same shortfalls (`cd agent && make test`).
- [x] 3.2 Build the *Staffing & coverage* tab: head count vs minimum (line + bar), a calendar heatmap of the shortfall, shortfall by shift and by workstation, days over the maximum, draft months marked, and a click that adds a day, shift or workstation selection. Verify with a spec that clicking a heatmap day adds a `day` chip and narrows the table.
- [x] 3.3 Write `model/hours.ts` and build the *Hours & fairness* tab: hours vs prorated target per employee, nights/weekends/holidays over time, and a box plot of the team spread. Verify with a spec that, on a fixture, the per-employee totals equal what `GET /analysis/fairness` returns for the same rows (a shared fixture with the Rust test from 1.2).
- [x] 3.4 Build the *Absences* tab: days by type over time, by employee, by weekday, with a click on a type to filter. Verify with a spec on fixture rows that selecting `sick` gives the expected weekday counts.
- [x] 3.5 Build the *Roster changes* tab: notices over time by source, top employees, workstations and actors, the share with a reason, an acknowledgement-lag histogram and the unacknowledged count. The table search covers reason, employee and actor. Verify with a spec that 5 unacknowledged notices in a fixture show 5, and that searching "Krank" filters by reason.
- [x] 3.6 Build the *Audit activity* tab: entries over time stacked by action, plus by item type and by actor. A group links to `/audit-log` with `from`, `to`, `action`, `entity_type` and `actor`. Verify with a spec that the generated link carries exactly those params.
- [x] 3.7 Build the *Planning runs* tab: runs over time by source and status, duration, solver outcomes, and auto runs taken vs kept as a proposal. Verify with a spec that 3 auto runs, one with a message, show 2 taken and 1 kept.
- [ ] 3.8 For every chart: a title, a visually hidden summary of its key figures, and the toolbox's saveAsImage. Verify with a spec that each tab's charts render their summary `<p>`, and by a manual dark-mode check that the colours switch without a refetch (network tab).

## 4. Documentation

- [x] 4.1 Add an Analytics section to the user guide (`docs/`), and add `pages/reports/analytics/` to the project structure in `CLAUDE.md`. Verify that the section explains the filters, cross-filtering, the six tabs, CSV/PNG export, and that coverage follows the plan check's counting.
- [x] 4.2 Add `docs/knowledge/guide/analytics-report.md`, plus an index entry and a `log.md` line. Verify that `shift-agent knowledge` lists it and that `searchKnowledge("coverage heatmap")` finds it.

## 5. End-to-end and integration

- [ ] 5.1 Add `e2e/resources/pages/analytics_page.resource` and `e2e/tests/reports/analytics.robot`:
  - a planner opens Analytics, picks a preset, filters a workstation, clicks a heatmap day, sees the chip and the narrowed table, and removes the chip;
  - a viewer is redirected;
  - an Audit activity group opens the filtered Audit log.

  Verify with `cd e2e && make dryrun`, then `make e2e ARGS="--include analytics"` against the local stack.
- [ ] 5.2 On seed data (`seed_data_v2.py`) covering at least 12 months, open the Analytics page with *last 12 months*. Verify that the roster-facts response is under 1 MB gzipped, that a filter click re-renders in under 200 ms (performance panel), and that the Hours tab matches the Fairness page for the same period.
- [ ] 5.3 Run `make test`, `cd ui && npm test && npm run build`, and `cd agent && make test`. Verify that all pass.

## Workflow follow-up

- Coordinate the sidebar Reports group with `rename-relationships-to-ontology` when either lands.
- Possible follow-ups (not in this change): saved views, scheduled reports, server-side pre-aggregation for very large tenants.
- Archive the change after review.
