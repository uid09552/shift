# personal-limits Specification

## Purpose
Per-employee limits the planner respects: max nights, max weekends, no nights, preferred days off.

## Requirements

### Requirement: Limit fields
Each employee SHALL optionally have max night shifts per calendar month, max weekends per calendar month, a no-night-shifts flag and preferred weekdays off.

#### Scenario: Read and replace
- **WHEN** a client reads or replaces an employee's limits
- **THEN** the stored limits are returned

### Requirement: Hard or soft
`personal_limits_mode` SHALL default to `hard`: the caps are never exceeded. In `soft` they MAY be exceeded only to fill a slot that would otherwise stay short, and the exceedance SHALL be named in the result message. `no_night_shifts` SHALL always be hard.

#### Scenario: Soft cap
- **WHEN** mode is soft and a slot cannot otherwise be filled
- **THEN** the cap is exceeded minimally and reported

### Requirement: Preferred days off
Preferred weekdays off SHALL cost `preference_weight` when violated, not forbid assignment.

#### Scenario: Preferred day
- **WHEN** only a preferred-off employee can fill a slot
- **THEN** they may be assigned at that cost

### Requirement: Plan check
The assistant's plan validation SHALL flag violations of all four limits.

#### Scenario: Violation flagged
- **WHEN** a plan exceeds a limit
- **THEN** the check reports it
