# ui-feedback Specification

## Purpose

Make the UI truthful about the outcome of loading and changing data, so that a failure is never mistaken for an empty list, an empty roster, or a change that went through.

## Requirements

### Requirement: Failed load is not empty data
When loading the data a page or panel shows fails, the UI SHALL show that it could not be loaded, together with a way to retry, in place of that data. It SHALL NOT show the empty state ("no items yet", an empty roster week) unless a load succeeded and returned nothing. This applies to the Shifts, Capabilities, Workstations and Employees lists, the Schedule, the Employee calendar and the Scheduler.

#### Scenario: Backend unreachable on the Shifts page
- **WHEN** the shift list request fails
- **THEN** the Shifts page shows a "could not be loaded" message with a Retry button, and not "No shifts yet"

#### Scenario: Retry succeeds
- **WHEN** the planner presses Retry and the request now succeeds
- **THEN** the list is shown and the error message is gone

#### Scenario: Genuinely empty
- **WHEN** the capability list request succeeds with no capabilities
- **THEN** the empty state is shown and no error message

#### Scenario: Roster fails to load
- **WHEN** the confirmed roster for the visible period fails to load on the Schedule
- **THEN** the Schedule shows a load error instead of a grid with no assignments

### Requirement: Failed action is reported
When a create, update, delete, import, download, activate or deactivate action fails, the UI SHALL show an error notice and SHALL leave the displayed data as it was before the action. The notice SHALL contain the reason the server gave, when it gave one, and a generic failure text otherwise. The user SHALL be able to dismiss it.

#### Scenario: Delete in a locked month
- **WHEN** a planner deletes an assignment on the Schedule and the server refuses because the month is locked
- **THEN** the assignment stays in the grid and a notice shows the server's reason

#### Scenario: Wish outside the wish window
- **WHEN** a viewer places a shift wish for a date outside the wish window and the server refuses
- **THEN** no wish appears and a notice shows the server's reason

#### Scenario: Shift still in use
- **WHEN** deleting a shift fails
- **THEN** the shift stays in the list and an error notice is shown

#### Scenario: Template download fails
- **WHEN** downloading an import template fails
- **THEN** an error notice is shown

#### Scenario: Reason dialog cancelled
- **WHEN** a change needs a reason and the planner cancels the reason dialog
- **THEN** the change is not applied and a notice reports that it was refused
