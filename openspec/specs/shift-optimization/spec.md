# shift-optimization Specification

## Purpose
Produce a proposed roster with a constraint solver and turn it into a confirmed plan.

## Requirements

### Requirement: Coverage first
The optimizer SHALL solve minimum staffing before balance, wishes and fatigue, and later goals SHALL NOT un-fill a slot. Slots still short SHALL be listed in `message`.

#### Scenario: Shortage
- **WHEN** a slot cannot be filled
- **THEN** the plan is returned and the slot named

### Requirement: Staffing mode
`min_staffing_mode` SHALL be `soft` (default, penalised) or `hard` (may return `infeasible`).

#### Scenario: Hard minimum
- **WHEN** mode is hard and staffing cannot be met
- **THEN** status is `infeasible`

### Requirement: Rest and workload rules
The optimizer SHALL honour night-shift recovery days, minimum rest hours, maximum consecutive days, maximum working days per week, employee unavailability, skills and shift availability.

#### Scenario: After night shift
- **WHEN** an employee works a night
- **THEN** they receive the configured recovery days off

### Requirement: Period boundaries
The backend SHALL send the confirmed roster of the 14 days before the period as read-only `history`, which carries recovery, rest and streaks across the start. Blocked slots SHALL NOT make the plan infeasible.

#### Scenario: Night on the 31st
- **WHEN** an employee worked a night on the last day of the previous month
- **THEN** they are not planned on the 1st within recovery or rest limits

### Requirement: Locked assignments
Locked assignments SHALL be kept; impossible ones are dropped and reported.

#### Scenario: Impossible lock
- **WHEN** a lock cannot hold
- **THEN** it is dropped and reported in `message`

### Requirement: Proposal lifecycle
A result SHALL remain an editable, checkable and repairable proposal until taken as plan, which writes confirmed shift plans. Taking as plan SHALL follow the status of every month the period touches, as roster publication defines. In a draft month it replaces the roster silently. In a published month it records each changed day as a change notice. In a locked month it is refused unless the caller is a `shift-admin` who gives a reason.

#### Scenario: Take as plan
- **WHEN** a user takes a result as plan
- **THEN** confirmed shift plans are created for it

#### Scenario: Take as plan into a published month
- **WHEN** a planner takes a result as plan for a period inside a published month
- **THEN** the roster is replaced and every changed day creates a notice for its employee

#### Scenario: Take as plan into a locked month
- **WHEN** a planner takes a result as plan for a period that touches a locked month
- **THEN** the request is refused and the roster is unchanged

### Requirement: Async planning
`POST /planner/plan` SHALL return a task id whose status can be polled; stale `scheduled` tasks older than three hours SHALL be marked failed at startup.

#### Scenario: Poll task
- **WHEN** a plan is requested
- **THEN** a task id is returned and its status can be polled

### Requirement: Stable re-planning against a published roster
When the planning period overlaps a `published` or `locked` month, the optimizer input SHALL carry that month's confirmed roster as `published_roster`. The solver SHALL minimise the employee-days that differ from it right after coverage and personal limits, ahead of balance, wishes and fatigue. Coverage SHALL still come first. `change_weight` (planner setting, default 100000) SHALL switch this on (> 0) or off (0). The output SHALL report the changed employee-days.

#### Scenario: Re-solve after one sick day
- **WHEN** a published month is re-solved after one employee was marked sick on one day
- **THEN** the result differs from the published roster only where needed to cover that day, plus whatever else the hard rules force

#### Scenario: Draft period
- **WHEN** the planning period lies entirely in draft months
- **THEN** no `published_roster` is sent and the solver behaves as before

#### Scenario: Change count reported
- **WHEN** a result differs from the published roster on 4 employee-days
- **THEN** the output reports 4 changes

#### Scenario: Balance does not move published people
- **WHEN** a published roster is uneven and a re-solve could balance hours only by changing published days
- **THEN** the published days are kept

#### Scenario: Weight off
- **WHEN** `change_weight` is 0
- **THEN** the published roster has no influence on the result
