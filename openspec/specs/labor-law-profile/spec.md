# labor-law-profile Specification

## Purpose
TBD - created by archiving change add-labor-law-profile. Update Purpose after archive.

## Requirements

### Requirement: Selectable profile
Planner settings SHALL carry `labor_law_profile`: `none` (default, behaviour unchanged) or `arbzg_de`. Only `shift-admin` and `shift-planner` MAY change it.

#### Scenario: Default
- **WHEN** a tenant has not chosen a profile
- **THEN** the profile is `none` and no legal rule is applied

#### Scenario: Select ArbZG
- **WHEN** a planner selects `arbzg_de`
- **THEN** optimizer runs and plan checks for that tenant apply the ArbZG rules

### Requirement: Working-time limits
Under `arbzg_de` the optimizer SHALL NOT assign an employee more than 10 hours (net of breaks) on one day, SHALL keep the average weekly hours at or below 48 over `labor_law_averaging_weeks` (default 24), and SHALL keep at least 11 hours of rest between shifts. Where a tenant limit is stricter, the stricter value applies.

#### Scenario: Daily cap
- **WHEN** a shift's net length exceeds 10 hours
- **THEN** no employee is assigned to it and the slot is reported short

#### Scenario: Average window
- **WHEN** assigning a shift would lift an employee's average over the window above 48 hours per week
- **THEN** that assignment is not made

#### Scenario: History counts
- **WHEN** the window reaches before the planning period
- **THEN** confirmed roster days in that part count toward the average

### Requirement: Breaks
A shift MAY define `break_minutes`. Under `arbzg_de` a shift longer than 6 hours SHALL have at least 30 break minutes and longer than 9 hours at least 45; a shift the plan uses with less SHALL be reported once as a legal finding.

#### Scenario: Missing break
- **WHEN** a 10-hour shift has `break_minutes` of 30
- **THEN** one legal finding names the shift

### Requirement: Minors
An employee under 18 on the day, from their stored date of birth, SHALL under `arbzg_de` NOT be assigned more than 8 hours a day or 40 hours a week, a night shift, or a Sunday or public holiday, SHALL work at most 5 days a week, and SHALL have 12 hours of rest (JArbSchG).

#### Scenario: Turning 18
- **WHEN** an employee turns 18 inside the period
- **THEN** the minor rules apply only to days before the birthday

### Requirement: Maternity protection
An employee with `maternity_protection` SHALL under `arbzg_de` NOT be assigned a night shift (20:00–06:00), a Sunday or a public holiday, or more than 8.5 hours a day (MuSchG). The flag SHALL be visible only to `shift-admin` and `shift-planner`, and results, findings and the audit log SHALL NOT state its value.

#### Scenario: Night shift
- **WHEN** the only candidate for a night slot is protected
- **THEN** the slot stays short and is named in `message`

#### Scenario: Viewer
- **WHEN** a `shift-viewer` reads their own employee record
- **THEN** the flag is absent

#### Scenario: Audit entry
- **WHEN** the flag is changed
- **THEN** the audit entry records that it changed, not the new value

### Requirement: Separate legal report
The plan check SHALL return legal findings in a `legal` section — profile, `compliant` flag, and findings each with the statute cited — apart from the soft-goal findings, and SHALL NOT list a legal breach in both. With profile `none` the section reports no profile.

#### Scenario: Violation
- **WHEN** a proposal gives an employee an 11-hour day under `arbzg_de`
- **THEN** `legal.compliant` is false and a finding cites ArbZG §3

#### Scenario: Soft goals unaffected
- **WHEN** a wish is unmet in an otherwise legal plan
- **THEN** `legal.compliant` is true and the wish appears only among soft findings

### Requirement: Warning on legal findings
Take as Plan and publish SHALL warn when the plan has legal findings but SHALL NOT refuse.

#### Scenario: Take illegal plan
- **WHEN** a planner takes a plan with legal findings
- **THEN** the warning lists them and the plan is taken after confirmation
