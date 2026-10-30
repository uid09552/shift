# Proposal

## Why

Planners can see one month of the roster at a time (Schedule), one period's
fairness table (Fairness) and the audit log as a list. They cannot answer
questions across time and across data:

- Are we short on nights more often since spring?
- Which workstation runs on its minimum every weekend?
- How many published days did we change last quarter, and why?
- Who edits the roster the most?
- How often did the automatic plan stay a proposal?

The data to answer these already exists: past confirmed months, absences,
change notices, audit entries and planning runs. It just has no place to be
explored, filtered and cross-checked. A report page in the style of Power BI
(global filters, linked charts, drill-down to the rows) turns that data into a
way to analyse, verify and validate the ward's planning.

## What Changes

- **New page *Analytics* under Reports**, next to the d3 network (Ontology /
  Relationships), for `shift-planner` and `shift-admin`.
- **One filter bar for every chart on the page:**
  - period presets and a custom range up to one year;
  - workstation, shift, employee and capability;
  - absence type and source.

  The filter state lives in the URL, so a view can be bookmarked and shared.
- **Linked charts.** Clicking a bar, a heatmap cell or a slice narrows the whole
  page to it, and the active selections show as removable chips. The ECharts
  toolbar saves any chart as PNG.
- **Six tabs:**
  - *Staffing & coverage*: head count against the minimum per day, shift and
    workstation; a calendar heatmap of the shortfall; days over the maximum.
  - *Hours & fairness*: hours against target, nights, weekends and holidays per
    person and over time; the spread across the team.
  - *Absences*: absence days by type, person and month; a weekday pattern.
  - *Roster changes*: change notices over time, by source, actor and
    workstation; share with a reason; how long until acknowledged.
  - *Audit activity*: entries by action, item type and actor over time, with
    one click through to the Audit log page, already filtered.
  - *Planning runs*: runs by source (manual or auto), status and duration;
    solver outcome; how often an automatic plan stayed a proposal.
- **A searchable detail table** under the charts shows the rows behind the
  current filter and selection. It exports to CSV.
- **New read-only backend endpoints** under `/analysis/` deliver the facts:
  - the roster facts with their dimensions;
  - change notices;
  - audit counts, aggregated on the server;
  - planning runs.

  Each is limited to the caller's tenant and to one year.
- **New UI dependency:** Apache ECharts, imported modularly and lazy-loaded
  with the page. ApexCharts (dashboard) and d3 (network) stay.

Out of scope:
- Saved or shared report definitions.
- Scheduled or e-mailed reports.
- A user-defined pivot or query builder.
- Showing the report to `shift-viewer`.
- Data older than what the database holds today. Roster rows are overwritten
  in place, so "what the roster looked like before a change" comes only from
  change notices and the audit log.

## Capabilities

### New Capabilities
- `analytics-data`: the read-only fact endpoints behind the report: what they
  return, their limits, tenant isolation, and which personal data they never
  contain.
- `analytics-report`: the Analytics page: access, the filter model and URL
  state, cross-filtering, the six analyses, the detail table and export, and
  loading and empty states.

### Modified Capabilities
_None._ Fairness, the Audit log and the network page keep their behaviour.
The Analytics page links to the Audit log with filters the Audit log already
accepts.

## Impact

- **Backend:**
  - `src/services/analysis.rs` and `src/repository/analysisrepository.rs`:
    four handlers and queries;
  - `src/server.rs`: routes;
  - `api/openapi.yaml`: four operations and their schemas. The MCP server
    therefore exposes them to the agent automatically.
- **UI:**
  - `ui/package.json`: `echarts` is added;
  - `ui/src/app/pages/reports/analytics/`: the page, the tab components and
    pure aggregation helpers with specs;
  - `app.routes.ts`: a lazy route with `writerGuard`;
  - the sidebar Reports group;
  - `shared/services/analysis.service.ts`;
  - translation keys (de and en).
- **Coordination:** the in-flight change `rename-relationships-to-ontology`
  touches the same Reports menu group. Whichever lands second rebases its
  sidebar entry.
- **Tests and docs:**
  - Rust tests for the endpoints;
  - Angular specs for the aggregation helpers;
  - a Robot suite `e2e/tests/reports/analytics.robot` with a page object;
  - the user guide and `CLAUDE.md` project structure;
  - a knowledge page for the agent.
