# automatic-planning Specification

## Purpose
Plan the roster on a rhythm the tenant sets, without anyone starting the run, and make the result the confirmed roster only when that is safe, leaving everything else for a planner to review.

## Requirements

### Requirement: Schedule setting
Each tenant SHALL have an automatic-planning schedule in its planner settings, off by default. It SHALL hold the number of weeks between runs (1 to 12), a weekday, a time of day, a start date that anchors the cycle, and the planning range. Only a `shift-planner` or `shift-admin` SHALL change it; every role MAY read it. A value outside these limits SHALL be refused with 400 and change nothing.

#### Scenario: Default
- **WHEN** a tenant that never touched the setting reads its planner settings
- **THEN** automatic planning is off

#### Scenario: Invalid interval
- **WHEN** a planner saves a schedule that runs every 0 weeks, or every 13
- **THEN** the request is refused with 400

#### Scenario: Viewer
- **WHEN** a `shift-viewer` tries to change the schedule
- **THEN** the request is refused and the schedule is unchanged

### Requirement: Planning range
The planning range SHALL be one of 2, 4, 6, 8 or 12 weeks, or 1, 2 or 3 months. Any other range SHALL be refused with 400.

#### Scenario: Offered ranges
- **WHEN** a planner saves a range of 6 weeks, or of 2 months
- **THEN** it is accepted

#### Scenario: Other range
- **WHEN** a planner saves a range of 5 weeks, or of 4 months
- **THEN** the request is refused with 400

### Requirement: Run days
A tenant's schedule SHALL start one run on each run day, at or after the set time, and no second one that day. A run day is a day on or after the start date that falls on the chosen weekday in a week whose distance from the start date's week is a multiple of the interval. Restarting the server, or running several backend instances, SHALL NOT cause a second run on the same day. A run day whose time had already passed when the schedule was switched on or last changed SHALL NOT run.

#### Scenario: Every second week
- **WHEN** the schedule is every 2 weeks on Monday from Monday 2026-10-05
- **THEN** runs happen on 2026-10-05 and 2026-10-19, and not on 2026-10-12

#### Scenario: Once per day
- **WHEN** the server restarts after that day's run has started
- **THEN** no second run starts that day

#### Scenario: Switched on after the time
- **WHEN** a planner switches the schedule on at 14:00 on a run day whose time is 02:00
- **THEN** nothing runs that day and the next run day is used

#### Scenario: Switched off
- **WHEN** the schedule is off on a run day
- **THEN** nothing runs

### Requirement: Range start and end
A run SHALL plan from the day after the last day that has a shift in the confirmed roster, but no earlier than the day after the run day, up to the day that lies the planning range after the run day (calendar months clamped to the month's last day). When that start lies after that end, the roster already reaches far enough: nothing SHALL be planned and the outcome SHALL say until when the roster is planned.

#### Scenario: Roster ends before the range
- **WHEN** a run on Monday 2026-10-05 with a range of 4 weeks finds the last planned shift on 2026-10-18
- **THEN** the run plans 2026-10-19 to 2026-11-02

#### Scenario: Nothing planned yet
- **WHEN** the confirmed roster has no shifts
- **THEN** the run plans from the day after the run day

#### Scenario: Months
- **WHEN** a run on 2026-01-31 has a range of 1 month
- **THEN** the range ends on 2026-02-28

#### Scenario: Already planned far enough
- **WHEN** the last planned shift is on or after the end of the range
- **THEN** no plan is started and the outcome is "already planned until" that date

### Requirement: A run is a normal plan
An automatic run SHALL plan like a planner's run: every employee, the tenant's current data and planner settings, labor law included. It SHALL appear among the planning runs marked as automatic and SHALL be recorded in the audit log under the actor `auto-planner`.

#### Scenario: Visible run
- **WHEN** an automatic run starts
- **THEN** the Runs tab lists it as automatic and the audit log names `auto-planner`

### Requirement: Take-over only when safe
An automatic run's result SHALL become the confirmed roster only if the solver status is optimal or feasible, the solver reports nothing to flag (no slot below minimum staffing, no fixed or locked assignment dropped, no personal limit exceeded), every month the range touches is `draft`, and the plan puts nobody to work on a day a person recorded as absent. Otherwise it SHALL stay a proposal, unchanged, and the outcome SHALL name the reason.

#### Scenario: Clean plan
- **WHEN** a run for a range in draft months finishes with nothing to flag
- **THEN** its assignments and free days are confirmed in the roster as automatic entries

#### Scenario: Short slot
- **WHEN** the solver reports a slot below minimum staffing
- **THEN** the result stays a proposal and the outcome names the short slot

#### Scenario: Published month
- **WHEN** the range touches a published or locked month
- **THEN** the result stays a proposal and the roster is unchanged

#### Scenario: Recorded absence
- **WHEN** the plan assigns a shift to someone on a day they recorded as sick, day off or holiday
- **THEN** the result stays a proposal and the outcome names the conflict

### Requirement: Take-over changes only the plan
Taking over an automatic plan SHALL write only the plan's entries. It SHALL NOT change an entry a person made, and SHALL NOT publish or lock any month.

#### Scenario: Manual entries stay
- **WHEN** a plan is taken over and the range holds an entry a person made
- **THEN** that entry is as it was afterwards

#### Scenario: Month stays draft
- **WHEN** a plan is taken over
- **THEN** its months are still `draft` and viewers do not see them

#### Scenario: Earlier automatic entries are replaced
- **WHEN** a later run plans days where an earlier automatic run left free-day entries
- **THEN** those entries are replaced by the new plan's

### Requirement: Outcome reported
The planner settings SHALL report the next run (date and time), and the last run's date, outcome and note. The outcome SHALL be one of: running, taken over, kept as proposal, skipped, failed. The settings page SHALL show them.

#### Scenario: Taken over
- **WHEN** a planner opens the settings after a run that was taken over
- **THEN** they see the run's date, that it was taken over, and the next run

#### Scenario: Kept as proposal
- **WHEN** the last run was kept as a proposal
- **THEN** the settings show why and point to the Runs tab

### Requirement: Failures are contained
When an automatic run cannot start (the planner is not connected, the data cannot be read) or the solver fails, no roster entry SHALL be written, the outcome SHALL be `failed` with the reason, and the next run SHALL happen on the next run day. A run whose result never arrives SHALL be reported as failed once the stale-task limit has passed.

#### Scenario: Planner unavailable
- **WHEN** a run day arrives and the planner is not connected
- **THEN** the outcome is failed, the roster is unchanged, and the next run day is unaffected

#### Scenario: Result never arrives
- **WHEN** a run's result has not arrived after the stale-task limit
- **THEN** the outcome becomes failed

### Requirement: Tenants are independent
Each tenant's schedule, run, range and outcome SHALL be its own. A run for one tenant SHALL NOT read, plan or write another tenant's data.

#### Scenario: Two tenants
- **WHEN** two tenants have schedules due on the same day
- **THEN** each gets its own run on its own data and each outcome is recorded for its own tenant
