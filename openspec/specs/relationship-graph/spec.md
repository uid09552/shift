# relationship-graph Specification

## Purpose
Shows planners how employees, capabilities, workstations and shifts are connected, and optionally who is rostered where on a chosen day or week, as one interactive network, so that coverage gaps and single points of failure become visible.

## Requirements

### Requirement: Relationship network
The Relationships page SHALL show one node per employee, capability, workstation and shift of the tenant. Each node type SHALL be distinguishable by shape or colour and SHALL carry the item's name. It SHALL draw an edge for every configured relationship: an employee has a capability, an employee may work a shift, a workstation requires a capability, and a workstation runs a shift. A legend SHALL explain node types and edge types.

#### Scenario: Qualified employee
- **WHEN** employee Anna has capability "Intensive Care" and may work the Night shift
- **THEN** the network shows edges Anna – "Intensive Care" and Anna – Night

#### Scenario: Workstation requirements
- **WHEN** workstation ICU requires "Intensive Care" and runs the Early and Night shifts
- **THEN** the network shows edges ICU – "Intensive Care", ICU – Early and ICU – Night

#### Scenario: Closed workstation
- **WHEN** a workstation is set unavailable
- **THEN** it is still shown, visibly marked as closed

### Requirement: Assignment period
The page SHALL let the user switch an assignment layer on and off, and choose either a single day or a calendar week (Monday to Sunday) for it. The default is the current week. With the layer off, no roster data SHALL be shown.

#### Scenario: Default period
- **WHEN** a planner switches the layer on without choosing a period
- **THEN** the current week's roster is drawn

### Requirement: Assignment edges
With the layer on, the page SHALL draw an edge from each employee to the workstation and to the shift of every confirmed roster entry in the period. These edges SHALL look different from configured relationships and SHALL show how many days of the period they cover. Absences and days off SHALL NOT be drawn.

#### Scenario: Week view
- **WHEN** the layer is on for a week in which Anna works Night at ICU on three days
- **THEN** Anna has an assignment edge to ICU and one to Night, each showing 3

#### Scenario: Single day
- **WHEN** the user picks one day on which Anna is rostered Early at ICU
- **THEN** only that day's entries are drawn, and Anna has assignment edges to ICU and Early

#### Scenario: Absence
- **WHEN** Anna is recorded sick on a day in the period
- **THEN** no assignment edge is drawn for that day

#### Scenario: Assignment outside the qualifications
- **WHEN** Anna is rostered at a workstation that requires a capability she does not have
- **THEN** that assignment edge is marked as not covered by her capabilities

### Requirement: Dragging and navigating
The user SHALL be able to drag any node, and the layout SHALL settle around it. A dragged node SHALL stay where it was dropped until the user releases it, for example by double-clicking it. The user SHALL be able to zoom and pan the view, and to reset the layout. Hovering or selecting a node SHALL highlight it, its direct neighbours and the edges between them, and dim the rest. Dragging, zooming and selecting SHALL NOT change any data.

#### Scenario: Pin a node
- **WHEN** the user drags the ICU node to the left edge and lets go
- **THEN** ICU stays there while the other nodes rearrange around it

#### Scenario: Neighbourhood
- **WHEN** the user selects capability "Intensive Care"
- **THEN** the employees who have it and the workstations that require it are highlighted, and everything else is dimmed

#### Scenario: Nothing is saved
- **WHEN** the user drags an employee node onto a workstation node
- **THEN** no roster entry, capability or configuration changes

### Requirement: Filters and search
The user SHALL be able to show or hide each node type and each edge type, and to search by name. A search SHALL highlight the matching nodes and their neighbours. Hiding a node type SHALL also hide the edges that end at it.

#### Scenario: Hide shifts
- **WHEN** the user hides shifts
- **THEN** shift nodes and every edge to a shift disappear, and the rest stays

#### Scenario: Search
- **WHEN** the user searches "Anna"
- **THEN** Anna and her direct neighbours are highlighted

### Requirement: Single points of failure
The page SHALL mark every capability that is required by at least one open workstation and held by fewer than two employees.

#### Scenario: Only one qualified person
- **WHEN** "Surgery" is required by an open workstation and only one employee has it
- **THEN** the "Surgery" node is marked as a single point of failure

### Requirement: Access
The page and its menu entry SHALL be available to `shift-planner` and `shift-admin`. A `shift-viewer` SHALL see neither the menu entry nor the page. Opening the page's address as a viewer SHALL NOT show it.

#### Scenario: Viewer
- **WHEN** a `shift-viewer` opens the Relationships address directly
- **THEN** the page is not shown

#### Scenario: Planner
- **WHEN** a planner opens the sidebar
- **THEN** a Reports group lists Relationships

### Requirement: Empty and large tenants
When the tenant has no employees, workstations, capabilities or shifts, the page SHALL say so instead of drawing an empty canvas. On a tenant with several hundred nodes, the page SHALL remain usable: the layout settles, and dragging follows the pointer.

#### Scenario: New tenant
- **WHEN** a tenant with no configuration opens the page
- **THEN** a message explains that there is nothing to show yet and links to the configuration pages
