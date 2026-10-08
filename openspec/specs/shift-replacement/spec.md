# shift-replacement Specification

## Purpose
Find a short-notice replacement for an absent person's shift.

## Requirements

### Requirement: Ranked candidates
`POST /agent/roster/replacements` SHALL be read-only and return everyone the rules allow, ranked by wish, preferred day off, hours below target, then rest.

#### Scenario: Sick colleague
- **WHEN** a replacement is requested for a confirmed shift
- **THEN** allowed colleagues are ranked and shown with how many remain against the shift minimum

### Requirement: Reasons for exclusion
Everyone not allowed SHALL be returned with the blocking reason (skills, rest, recovery, streaks, weekly cap, station maximum, hard personal limits).

#### Scenario: Excluded colleague
- **WHEN** a colleague is not allowed
- **THEN** the blocking reason is returned

### Requirement: Assign
Assigning SHALL mark the absent person sick, vacation or absent and place the colleague on the shift.

#### Scenario: Assign replacement
- **WHEN** a planner assigns a colleague
- **THEN** the absent person is marked absent and the colleague holds the shift
