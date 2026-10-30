# analytics-data Specification

## Purpose
Read-only data endpoints behind the Analytics report. They deliver the roster, change notices, audit activity and planning runs of a period as compact facts, limited to the caller's tenant and free of protected personal data.

## Requirements

### Requirement: Common period and access rules
Every analytics fact endpoint SHALL take `from_date` and `to_date` (YYYY-MM-DD, inclusive). It SHALL refuse a reversed range or one longer than 366 days with a validation error. It SHALL answer only `shift-planner` and `shift-admin`, and only with the caller's tenant's data. None of them SHALL write anything.

#### Scenario: Viewer is refused
- **WHEN** a `shift-viewer` calls any analytics fact endpoint
- **THEN** the answer is 403 and no data is returned

#### Scenario: Range too long
- **WHEN** `from_date` and `to_date` are more than 366 days apart
- **THEN** the answer is a validation error naming the one-year limit

#### Scenario: Tenant isolation
- **WHEN** two tenants have roster entries on the same dates
- **THEN** each tenant's call returns only its own rows

### Requirement: Roster facts
`GET /analysis/roster-facts` SHALL return one row per confirmed roster entry in the period. A row holds the date, employee, shift, workstation, presence, absence type, creation type, hours, and whether the day is a night shift, a weekend or a public holiday. Hours, night and weekend SHALL be counted exactly as `GET /analysis/fairness` counts them.

#### Scenario: Night on a holiday
- **WHEN** an employee works a night shift on a public holiday
- **THEN** that row has `is_night` and `is_holiday` true, and the same hours the Fairness report counts for that entry

#### Scenario: Absence row
- **WHEN** an entry is a recorded sick day
- **THEN** the row has `is_present` false, `absence_type` set to the sick type, and zero hours

### Requirement: Roster fact context
The roster facts answer SHALL also carry what the report needs to interpret the rows:
- the dimensions: employees with their capabilities and weekly target hours, shifts, workstations;
- each shift's and workstation's minimum and maximum per weekday;
- the workstation closures in the period;
- the public holidays in the period;
- the status of each month.

#### Scenario: Staffing rules included
- **WHEN** a shift requires two people on Saturdays
- **THEN** the answer's shift dimension lists a minimum of 2 for weekday Saturday

#### Scenario: Holiday uses Sunday rules
- **WHEN** a public holiday falls on a Wednesday
- **THEN** its row is marked `is_holiday`, and the staffing rules that apply to it are the Sunday ones, as in the planner

### Requirement: No protected personal data
The analytics endpoints SHALL NOT return date of birth, maternity protection, the reason behind a personal limit, or any other personal-limit field. Employee dimensions SHALL carry only id, name, capabilities and weekly target hours.

#### Scenario: Protected employee
- **WHEN** an employee has maternity protection recorded
- **THEN** no analytics answer contains that fact or any field derived from it

### Requirement: Change-notice facts
`GET /analysis/change-facts` SHALL return one row per roster change notice created in the period. A row holds:
- the creation time and the changed day;
- the employee and the workstation before and after;
- the source and the actor;
- the reason text;
- the acknowledgement time, if any.

#### Scenario: Unacknowledged notice
- **WHEN** a notice has not been acknowledged
- **THEN** its row has a null acknowledgement time

#### Scenario: Replacement source
- **WHEN** a change was made as a short-notice replacement
- **THEN** its row's source is `replacement`

### Requirement: Audit activity aggregates
`GET /analysis/audit-activity` SHALL return audit entry counts in the period, grouped by day, action, item type and actor, and computed by the database. The rows themselves stay on `GET /audit-logs`. The answer SHALL also return the total entry count, which equals the sum of the groups.

#### Scenario: Counts match the log
- **WHEN** the audit log holds 40 entries in the period
- **THEN** the groups' counts sum to 40, and filtering `/audit-logs` by one group's action, item type, actor and day returns that group's count

#### Scenario: Automatic planner as actor
- **WHEN** automatic planning wrote entries
- **THEN** they are counted under actor `auto-planner`

### Requirement: Planning-run facts
`GET /analysis/planning-runs` SHALL return one row per planning task created in the period. A row holds:
- the creation and finish time, and the source (`manual` or `auto`);
- the task status and any error;
- the result's planning period;
- the solver status and whether its message was non-empty;
- for automatic runs, whether the plan became the roster.

It SHALL NOT return the plan itself.

#### Scenario: Automatic run that stayed a proposal
- **WHEN** an automatic run finished feasible, but with a non-empty message
- **THEN** its row has source `auto`, solver status `feasible`, `has_message` true, and `taken_as_roster` false

#### Scenario: Failed task
- **WHEN** a task failed before the solver answered
- **THEN** its row has the failed status, the error, and no solver status

### Requirement: Published API
The four endpoints SHALL be described in the OpenAPI specification with their parameters and response schemas, so that the MCP server offers them as tools.

#### Scenario: Agent can query roster facts
- **WHEN** the MCP server starts from the updated specification
- **THEN** it lists a tool for each of the four endpoints
