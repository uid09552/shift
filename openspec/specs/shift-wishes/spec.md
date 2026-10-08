# shift-wishes Specification

## Purpose
Let employees request a shift on a date, bounded by a tenant-wide wish window.

## Requirements

### Requirement: Wishes are soft
A wish SHALL reward the optimizer (`wish_weight`) and SHALL NOT be guaranteed.

#### Scenario: Conflicting wish
- **WHEN** a wish conflicts with a hard rule
- **THEN** the plan ignores the wish

### Requirement: Who may enter wishes
Users with `shift-viewer` SHALL enter only their own wishes; `shift-planner` and `shift-admin` MAY enter anyone's.

#### Scenario: Viewer enters for a colleague
- **WHEN** a shift-viewer submits a wish for another employee
- **THEN** the request is refused

### Requirement: Wish window
The system SHALL keep one wish window per tenant with mode `enabled`, `disabled` or `date_range` (with start and end). The window SHALL bind every role, including `shift-admin`. Only `shift-admin` MAY change it.

#### Scenario: Wish outside window
- **WHEN** any user submits a wish for a date the window does not allow
- **THEN** the wish is refused

#### Scenario: Planner changes window
- **WHEN** a non-admin sends a window update
- **THEN** the request is refused
