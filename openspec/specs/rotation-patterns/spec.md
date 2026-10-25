# rotation-patterns Specification

## Purpose
Define repeating cycles of shifts and days off and apply them as fixed shift assignments.

## Requirements

### Requirement: Fixed assignments
A fixed assignment SHALL state that an employee works a shift on a day, or, with no shift, has the day off.

#### Scenario: Day off assignment
- **WHEN** an assignment has no shift
- **THEN** the employee is off that day

### Requirement: Applying a pattern
Applying a pattern SHALL write fixed assignments for chosen employees with a stagger between them; a dry run SHALL preview without writing.

#### Scenario: Dry run
- **WHEN** a pattern is applied with `dry_run`
- **THEN** the resulting assignments are returned and nothing is stored

### Requirement: Optimizer handling
The optimizer SHALL keep fixed assignments ahead of every other goal, unless `keep_fixed_assignments` is off, in which case it ignores them. An assignment a rule forbids SHALL be reported in the result message and SHALL NOT make the plan infeasible.

#### Scenario: Forbidden rotation
- **WHEN** a fixed assignment breaks a rule
- **THEN** it is not planned and is named in the message

### Requirement: Full-width apply screen
The Rotations page SHALL give the Apply panel the full width of the page, with the pattern list above it, so the preview grid is not confined to a partial column.

#### Scenario: Wide screen
- **WHEN** the Rotations page is shown on a wide screen
- **THEN** the Apply panel spans the full content width and the preview grid uses all of it

#### Scenario: Many days
- **WHEN** a preview covers more days than fit the width
- **THEN** the grid scrolls horizontally within the panel while the employee names stay visible

#### Scenario: Narrow screen
- **WHEN** the page is shown on a narrow screen
- **THEN** the pattern list and Apply panel stack in one column
