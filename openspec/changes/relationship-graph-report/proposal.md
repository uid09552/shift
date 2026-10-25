# Proposal

## Why

Who can work where is spread over four configuration pages today: an
employee's capabilities and available shifts, a workstation's required
capabilities and active shifts. A planner who wants to know "who could cover
the ICU on nights?" or "which workstation has only one qualified person?" has
to piece it together in their head. The roster for a day or a week only shows
the result, not the web of qualifications behind it. One interactive picture
of these relationships makes gaps and single points of failure visible at a
glance.

## What Changes

- A new **Reports** group in the sidebar, with a **Relationships** page.
- The page draws a force-directed network of employees, capabilities,
  workstations and shifts, with an edge for each relationship:
  - employee has capability
  - employee may work shift
  - workstation requires capability
  - workstation runs shift
- An optional **assignment layer** for a chosen day or week. It adds an edge
  for every confirmed roster entry ("employee works shift at workstation"),
  so the configured web and the actual roster are shown together.
- Nodes can be dragged to untangle the layout, and a dragged node stays
  where it was dropped until released. Hovering or selecting a node
  highlights its neighbours. Filters by node type and a name search narrow
  the picture.
- **Read-only.** Nothing on the page changes configuration or the roster.
  Dragging moves nodes on screen only.
- `d3` becomes a direct UI dependency.

## Capabilities

### New Capabilities
- `relationship-graph`: the Relationships report. What it shows, which
  relationships and roster entries it draws, how it is filtered and
  navigated, and who may see it.

### Modified Capabilities

None.

## Impact

- UI: a new page under `ui/src/app/pages/reports/`, a new sidebar group and
  route, translations, and `d3` (with `@types/d3`) in `ui/package.json`.
- Data: existing read endpoints only (`/employees`, `/shifts`,
  `/capabilities`, `/workstations` and per-workstation required
  capabilities, `/confirmed-shift-plans`). No backend change.
- Access: planners and admins. `shift-viewer` does not get the page,
  because it shows every colleague's qualifications.
