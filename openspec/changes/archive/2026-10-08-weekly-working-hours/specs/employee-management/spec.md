## MODIFIED Requirements

### Requirement: Employee records
The system SHALL store per tenant an employee's name, email and contracted weekly working hours. The weekly hours SHALL be optional: an employee without a value follows the tenant's default. A value of 0 SHALL mean the employee has no hours target.

#### Scenario: Create employee
- **WHEN** a planner creates an employee with name, email and weekly hours
- **THEN** the employee is returned and appears in the employee list of that tenant only

#### Scenario: Create employee without hours
- **WHEN** a planner creates an employee without weekly hours
- **THEN** the employee is stored without a value and their effective weekly hours are the tenant default

#### Scenario: Monthly hours refused
- **WHEN** a client sends `monthly_working_hours`
- **THEN** the request is refused with a message naming `weekly_working_hours`

### Requirement: Contracted hours as optimizer target
The effective weekly hours SHALL be prorated to the planning period as weekly hours × days ÷ 7 and used as a target the optimizer approaches; deviation is penalised, never forbidden. The same proration SHALL apply wherever a target for a period is shown or checked.

#### Scenario: Two-week period
- **WHEN** the planning period is 14 days and the effective weekly hours are 40
- **THEN** the target is 80 hours

#### Scenario: Calendar month
- **WHEN** a target is shown for a 31-day month and the effective weekly hours are 35
- **THEN** the target is 155 hours

#### Scenario: Under-staffed month
- **WHEN** hitting the target would break a hard rule
- **THEN** the plan is still produced with hours off target

## ADDED Requirements

### Requirement: Default weekly hours
Each tenant SHALL have a default weekly working hours setting, 40 unless changed. Planners and admins MAY change it; every role MAY read it. A change SHALL apply to every employee without their own value, from the next read on.

#### Scenario: Default applies
- **WHEN** a tenant has not changed the default and an employee has no weekly hours of their own
- **THEN** the employee's effective weekly hours are 40

#### Scenario: Default changed
- **WHEN** a planner sets the default to 38.5
- **THEN** employees without their own value have effective weekly hours of 38.5 and employees with their own value keep it

#### Scenario: Viewer changes default
- **WHEN** a viewer attempts to change the default
- **THEN** the request is refused

### Requirement: Effective hours in responses
Employee responses SHALL include both the employee's own weekly hours (empty when not set) and the effective weekly hours, so a client can tell an own value from the default.

#### Scenario: Own value shown
- **WHEN** an employee with 30 weekly hours is read
- **THEN** both the own and the effective weekly hours are 30

#### Scenario: Default shown
- **WHEN** an employee without own hours is read in a tenant whose default is 40
- **THEN** the own weekly hours are empty and the effective weekly hours are 40

### Requirement: Migration from monthly hours
Existing monthly hours SHALL be converted to weekly hours as monthly × 12 ÷ 52, rounded to the nearest 0.5, and kept as the employee's own value. Employees with 0 monthly hours SHALL have no own value afterwards and follow the default.

#### Scenario: Converted value
- **WHEN** an employee had 160 monthly hours before the migration
- **THEN** they have 37 own weekly hours afterwards

#### Scenario: Never set
- **WHEN** an employee had 0 monthly hours before the migration
- **THEN** they have no own weekly hours afterwards and follow the default
