## MODIFIED Requirements

### Requirement: Employee records
The system SHALL store per tenant an employee's name, email and contracted weekly working hours.

#### Scenario: Create employee
- **WHEN** a planner creates an employee with name, email and weekly hours
- **THEN** the employee is returned and appears in the employee list of that tenant only

### Requirement: Contracted hours as optimizer target
The contracted weekly hours SHALL be prorated by days to the planning period and used as a target the optimizer approaches; deviation is penalised, never forbidden.

#### Scenario: Partial-week period
- **WHEN** the planning period is 14 days and weekly hours are 40
- **THEN** the target is 80 hours

#### Scenario: Under-staffed month
- **WHEN** hitting the target would break a hard rule
- **THEN** the plan is still produced with hours off target
