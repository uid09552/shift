## MODIFIED Requirements

### Requirement: Reasons for exclusion
Everyone not allowed SHALL be returned with the blocking reason (skills, rest, recovery, streaks, weekly cap, station maximum, hard personal limits). The same checks SHALL be available for a proposed exchange of two roster shifts, returning violations per employee.

#### Scenario: Excluded colleague
- **WHEN** a colleague is not allowed
- **THEN** the blocking reason is returned

#### Scenario: Exchange check
- **WHEN** the checks are run for a proposed exchange
- **THEN** violations are returned for each of the two employees
