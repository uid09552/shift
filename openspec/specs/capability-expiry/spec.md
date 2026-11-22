# capability-expiry Specification

## Purpose
A qualification an employee holds may lapse (a resuscitation certificate). After its last valid day it no longer counts for planning, and planners see it coming.

## Requirements

### Requirement: Setting the date
A planner or admin SHALL be able to set, change or clear the last valid day of a capability an employee holds. Setting it for a capability the employee does not hold SHALL be a 404.

### Requirement: Planning stops counting it
After its last valid day a capability SHALL NOT count toward a workstation's requirements — in the solver, the plan check, repair, short-notice replacement and open shifts. Up to and including that day it SHALL count.

#### Scenario: Lapses inside the period
- **WHEN** the only qualified employee's certificate lapses on the second day of a period
- **THEN** they are planned on the first two days only, and the later days are reported short

#### Scenario: Plan check
- **WHEN** a plan assigns someone after their qualification lapsed
- **THEN** the plan check reports `capability_expired` as an error, not `missing_skills`

### Requirement: Warning in advance
Planners and admins SHALL see the capabilities that have lapsed or lapse within a chosen number of days (60 on the Employees page), soonest first. Others MAY NOT.
