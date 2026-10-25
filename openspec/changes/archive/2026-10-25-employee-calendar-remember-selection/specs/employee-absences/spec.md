# Spec Delta

## MODIFIED Requirements

### Requirement: Absences are recorded in the calendar
The employee calendar SHALL let a planner or admin record an absence from the month calendar, with no second calendar and no separate absences section. The page SHALL have the sections Calendar and Hours only. A link to the former absences section SHALL open the Calendar. A `shift-viewer` SHALL NOT be offered the controls. The add-absence action SHALL be offered only while the Calendar section is shown; switching to Hours SHALL end absence mode as Cancel does.

#### Scenario: Two sections
- **WHEN** a planner opens the employee calendar for an employee
- **THEN** the sections are Calendar and Hours, and the Calendar offers an add-absence action

#### Scenario: Old link
- **WHEN** a user opens the employee calendar with `tab=absences` in the address
- **THEN** the Calendar section is shown

#### Scenario: Viewer
- **WHEN** a `shift-viewer` opens the employee calendar
- **THEN** no add-absence action is offered

#### Scenario: Hours section
- **WHEN** a planner opens the Hours section
- **THEN** no add-absence action is offered

#### Scenario: Switching away mid-selection
- **WHEN** a planner has selected days in absence mode and switches to Hours, then back to Calendar
- **THEN** absence mode has ended, nothing is selected and nothing was saved

### Requirement: List of absences
Below the calendar the page SHALL list the employee's absences as ranges, grouped into upcoming and past, with the number of ranges and a way to delete each, after a confirmation. The list SHALL not depend on the month displayed. The list SHALL be collapsed by default behind a heading that shows the number of ranges, and SHALL open and close on that heading by mouse and keyboard.

#### Scenario: Grouped
- **WHEN** an employee has one absence next week and one last month
- **THEN** the list shows one upcoming and one past range

#### Scenario: Deleting
- **WHEN** a planner deletes a range and confirms
- **THEN** its days are removed from the list and the calendar

#### Scenario: Collapsed by default
- **WHEN** a planner opens the employee calendar for an employee with two absence ranges
- **THEN** the heading shows two ranges and the ranges themselves are not shown

#### Scenario: Opening the list
- **WHEN** the planner activates the heading
- **THEN** the upcoming and past ranges are shown
