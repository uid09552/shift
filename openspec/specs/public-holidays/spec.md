# public-holidays Specification

## Purpose
Treat public holidays like weekend days in planning and reporting.

## Requirements

### Requirement: Holiday sync
The system SHALL fetch holidays for the configured state from the configured source and store them per tenant; `POST /holidays/sync` triggers it and `GET /holidays` lists them.

#### Scenario: Sync
- **WHEN** a sync is requested
- **THEN** holidays for the period are stored for the tenant

### Requirement: Holiday treatment
A holiday SHALL use its shifts' Sunday times and SHALL count as a weekend day in the solver, plan check, repair and fairness analysis. No separate staffing minimum applies.

#### Scenario: Weekend cap
- **WHEN** an employee works a holiday
- **THEN** it counts toward their weekend limit

### Requirement: Visibility
Holidays SHALL be shown in the Schedule and Employee calendar views.

#### Scenario: Calendar display
- **WHEN** a holiday falls in the shown range
- **THEN** it is marked in the calendar
