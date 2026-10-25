# Design

## Context

- The data already exists behind read endpoints the UI uses.
  - `GET /employees` returns each employee with `capabilities` and
    `available_shifts`.
  - `GET /workstations` returns `available`, `active_shift_ids`, priority and
    staffing limits. Required capabilities come from
    `GET /workstations/{id}/required-capabilities`, one call per workstation.
  - `GET /shifts` and `GET /capabilities` list the rest.
  - `GET /confirmed-shift-plans?from_date&to_date` returns roster entries
    with `employee_id`, `shift_id`, `workstation_id`, `is_present` and
    `absence_type`.
- The UI has no d3 dependency. d3 used to be installed only because amcharts
  depended on it, and the open change `remediate-snyk-findings` removes
  amcharts. Charts elsewhere use ApexCharts.
- The sidebar ([app-sidebar.component.ts](../../../ui/src/app/shared/layout/app-sidebar/app-sidebar.component.ts))
  has an `adminOnly` flag on sub-items but nothing for planner-or-admin.
  Routes for planners use `writerGuard`
  ([form.guards.ts](../../../ui/src/app/shared/guards/form.guards.ts)),
  which redirects everyone else to `data.listPath`.
- Pages live under `ui/src/app/pages/<area>/`, are standalone components and
  use the `t` translation pipe.

## Goals / Non-Goals

**Goals:**
- One page that loads in a few requests and draws the whole tenant.
- Interactions (drag, zoom, highlight, filter) run entirely in the browser.

**Non-Goals:**
- Editing anything from the graph. That was decided: the page is read-only.
- A new backend endpoint. See Decision 2.
- Moving *Fairness* into the new Reports group. It stays where planners
  know it; the group can collect it later.
- Exporting the graph as an image.

## Decisions

**1. d3 (`d3-force`, `d3-drag`, `d3-zoom`, `d3-selection`) for layout and
interaction, rendered as SVG.**
A force simulation is the natural layout for a network with no hierarchy,
and `d3-drag` gives the pin-on-drop behaviour the spec asks for (`fx`/`fy`
set on drag end, cleared on double-click). Use the modular packages rather
than the `d3` bundle to keep the page's lazy chunk small.
*Alternatives:* ApexCharts has no network chart. Cytoscape.js would also
work, but it is a second graph library for one page and was not what was
asked for. Canvas rendering scales better, but SVG keeps hover, focus and
`data-testid` hooks simple at ward sizes. Revisit Canvas only if a tenant
exceeds roughly 1,000 nodes.

**2. Assemble the graph in the browser from existing endpoints.**
A `forkJoin` loads employees, shifts, capabilities and workstations, then
each workstation's required capabilities. That's one call per workstation:
tens of calls on a ward, made in parallel and once per page visit.
Confirmed plans are loaded only when the assignment layer is on, and again
when its period changes. A small pure function `buildGraph(data, layer)`
turns the responses into `{nodes, links}` and is unit-tested without a DOM.
*Alternative:* `GET /analysis/relationships` returning the graph in one
response. That's cleaner at scale, but it is a new endpoint, OpenAPI entry
and Rust tests for something the UI can do today. It becomes worthwhile if
the per-workstation calls show up as slow.

**3. Node identity and edge aggregation.**
Node ids are `type:uuid` (`emp:…`, `cap:…`, `ws:…`, `shift:…`), so ids of
different entity types cannot collide. Assignment edges are aggregated per
(employee, workstation) and per (employee, shift) over the period, with a
`days` count that drives stroke width and label. An assignment edge is
flagged `uncovered` when the employee lacks a capability the workstation
requires, using the same capability sets the configured edges use.

**4. Visual encoding.**
Each node type has a distinct shape and token colour: circle = employee,
diamond = capability, square = workstation, hexagon = shift. Each shift node
uses the shift's own colour as its fill, so it matches the Schedule page.
Configured edges are thin and solid, assignment edges are thicker and
dashed, and uncovered assignments use the warning colour. A single point of
failure gets a warning ring on its capability node. Closed workstations are
drawn hollow.

**5. Access.**
The route uses `writerGuard`, with `data.listPath: '/'`, so viewers land on
the dashboard. Sub-items get a new `plannerOnly` flag, filtered the way
`adminOnly` is, through `UserService.canPlan()`. The Reports group is
dropped when it ends up with no items.

**6. Page structure.**
A toolbar holds the node-type and edge-type toggles, search, the assignment
layer switch with day/week mode and a date picker, and Reset layout. Below
it, an SVG fills the remaining height, the way the Schedule page sizes its
table. A side panel shows the selected node's details and neighbours. The
simulation stops after it settles and restarts on drag or on a filter
change.

## Risks / Trade-offs

- [A large tenant makes the force layout jittery or slow] → reduce `alpha`
  decay time, set link distance by edge type, and stop the simulation once
  settled. The spec's large-tenant scenario is checked with a generated
  500-node fixture.
- [Hairball: everything connects to everything] → node-type and edge-type
  toggles default to employees + capabilities + workstations, with shifts
  hidden. Selecting a node dims all but its neighbourhood.
- [One failed workstation call blanks the whole page] → each
  required-capabilities call falls back to an empty list on error, and the
  page reports which workstations it could not load.
- [Conflict with `remediate-snyk-findings`] → that change removes amcharts
  (and with it the transitive d3). This change adds the d3 modules as direct
  dependencies. Whichever lands second regenerates `package-lock.json`.

## Migration Plan

UI-only and additive. Rollback means removing the route and menu entry.
