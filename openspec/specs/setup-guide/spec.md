# setup-guide Specification

## Purpose
A new organization reaches a first feasible plan by following one checklist, without knowing the order the planner needs things in.

## Requirements

### Requirement: The checklist
The system SHALL report, in order, whether the organization has shifts with times, capabilities, workstations, employees, saved planner settings and a first plan (a plan run or a confirmed roster entry), each with a count. Each step SHALL link to the page where it is done.

#### Scenario: Next step
- **WHEN** shifts and capabilities exist but no workstation
- **THEN** workstations is the step marked as next, with a link to add one

### Requirement: Shown to admins until done
Admins SHALL see the checklist's progress on the overview while it is incomplete. They SHALL be able to hide it and reopen the guide from the user menu. Planners and viewers SHALL NOT see it.

#### Scenario: Hide
- **WHEN** an admin hides the banner
- **THEN** the overview no longer shows it, and the user menu still opens the guide

### Requirement: Sample data
An admin SHALL be able to load sample data — shifts, capabilities, workstations and employees enough to calculate a plan — into an organization that has none of these. It SHALL be refused once any exist, so sample data never mixes with real data.

#### Scenario: Empty organization
- **WHEN** an admin loads sample data into an empty organization
- **THEN** the first four steps are done

#### Scenario: Real data
- **WHEN** the organization already has employees
- **THEN** loading sample data is refused
