# employee-management Specification

## Purpose
Maintain hospital staff, their qualifications, the shifts they may work and their contracted hours.

## Requirements

### Requirement: Employee records
The system SHALL store per tenant an employee's name, email and contracted monthly working hours.

#### Scenario: Create employee
- **WHEN** a planner creates an employee with name, email and monthly hours
- **THEN** the employee is returned and appears in the employee list of that tenant only

### Requirement: Capabilities and available shifts
The system SHALL let an employee hold capabilities and a set of shifts they may work.

#### Scenario: Skill-gated workstation
- **WHEN** an employee lacks a capability a workstation requires
- **THEN** the optimizer does not assign that employee to the workstation

### Requirement: Bulk import
The system SHALL import employees from a spreadsheet and provide a template for it.

#### Scenario: Download template
- **WHEN** a user requests the employee template
- **THEN** a spreadsheet with the expected columns is returned

### Requirement: Contracted hours as optimizer target
The contracted hours SHALL be a target the optimizer approaches; deviation is penalised, never forbidden.

#### Scenario: Under-staffed month
- **WHEN** hitting the target would break a hard rule
- **THEN** the plan is still produced with hours off target
