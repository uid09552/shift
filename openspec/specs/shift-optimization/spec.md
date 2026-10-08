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
A result SHALL remain an editable, checkable and repairable proposal until taken as plan, which writes confirmed shift plans.

#### Scenario: Take as plan
- **WHEN** a user takes a result as plan
- **THEN** confirmed shift plans are created for it

### Requirement: Async planning
`POST /planner/plan` SHALL return a task id whose status can be polled; stale `scheduled` tasks older than three hours SHALL be marked failed at startup.

#### Scenario: Poll task
- **WHEN** a plan is requested
- **THEN** a task id is returned and its status can be polled
