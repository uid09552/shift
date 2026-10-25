# Spec Delta

## MODIFIED Requirements

### Requirement: Relationship network
The Ontology page SHALL show one node per employee, capability, workstation and shift of the tenant. Each node type SHALL be distinguishable by shape or colour and SHALL carry the item's name. It SHALL draw an edge for every configured relationship: an employee has a capability, an employee may work a shift, a workstation requires a capability, and a workstation runs a shift. A legend SHALL explain node types and edge types.

#### Scenario: Qualified employee
- **WHEN** employee Anna has capability "Intensive Care" and may work the Night shift
- **THEN** the network shows edges Anna – "Intensive Care" and Anna – Night

#### Scenario: Workstation requirements
- **WHEN** workstation ICU requires "Intensive Care" and runs the Early and Night shifts
- **THEN** the network shows edges ICU – "Intensive Care", ICU – Early and ICU – Night

#### Scenario: Closed workstation
- **WHEN** a workstation is set unavailable
- **THEN** it is still shown, visibly marked as closed

### Requirement: Access
The page and its menu entry SHALL be available to `shift-planner` and `shift-admin`. A `shift-viewer` SHALL see neither the menu entry nor the page. Opening the page's address as a viewer SHALL NOT show it.

#### Scenario: Viewer
- **WHEN** a `shift-viewer` opens the Ontology address directly
- **THEN** the page is not shown

#### Scenario: Planner
- **WHEN** a planner opens the sidebar
- **THEN** a Reports group lists Ontology

## ADDED Requirements

### Requirement: Former address
The page's former address, `/relationships`, SHALL lead to the Ontology page at `/ontology` under the same access rules, so links and bookmarks to the old name keep working.

#### Scenario: Planner follows an old bookmark
- **WHEN** a planner opens `/relationships`
- **THEN** the address becomes `/ontology` and the Ontology page is shown

#### Scenario: Viewer follows an old bookmark
- **WHEN** a `shift-viewer` opens `/relationships`
- **THEN** the page is not shown
