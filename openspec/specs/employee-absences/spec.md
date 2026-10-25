# employee-absences Specification

## Purpose
Let a planner record an employee's absences from the employee calendar itself, choosing the days on the month grid and the type with toggle boxes, seeing what the change will replace before applying it.

## Requirements

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

### Requirement: Selecting days on the grid
Choosing add absence SHALL put the grid into absence mode: a first click on a day of the month SHALL set the start, a second click the end (inclusive, in either order, the same day twice for one day), and a further click SHALL start a new selection. The selection SHALL be highlighted, SHALL survive changing the month, and SHALL be cleared when the mode is left. In the mode a click SHALL NOT open a shift, wish or workstation menu or change the roster.

#### Scenario: A range
- **WHEN** a planner clicks 12 October and then 16 October
- **THEN** 12 to 16 October, five days, are selected

#### Scenario: Backwards
- **WHEN** a planner clicks 16 October and then 12 October
- **THEN** the same five days are selected

#### Scenario: Across months
- **WHEN** a planner clicks 29 October, goes to the next month and clicks 3 November
- **THEN** 29 October to 3 November, six days, are selected

#### Scenario: New selection
- **WHEN** a range is selected and the planner clicks another day
- **THEN** that day becomes the new start and the range is cleared

#### Scenario: No accidental edits
- **WHEN** the grid is in absence mode and the planner clicks an empty day or a shift
- **THEN** the day is selected and no menu opens

#### Scenario: Leaving
- **WHEN** the planner cancels or presses Escape
- **THEN** the mode ends and nothing is selected or saved

### Requirement: Type chosen with toggle boxes
The type SHALL be chosen with separate toggle boxes for Unavailable, Vacation and Sick, each with its colour and a short meaning, exactly one on at a time. None SHALL be on initially, and adding SHALL be possible only once one is. The boxes SHALL be operable by keyboard and announced as a group of radio options, not as tabs.

#### Scenario: Nothing preselected
- **WHEN** the panel opens
- **THEN** no type is on and the add action is disabled

#### Scenario: One at a time
- **WHEN** a planner turns on Sick after Vacation
- **THEN** Sick is on and Vacation is off

#### Scenario: Keyboard
- **WHEN** a planner moves between the boxes with the arrow keys and presses Space
- **THEN** the focused box is turned on

### Requirement: Effect shown before adding
The panel SHALL show the selected dates and the number of days. It SHALL show how many of those days already hold a shift or an absence that the new absence replaces, counted for the whole range including other months. For Unavailable, days already marked unavailable SHALL be listed as skipped and SHALL NOT be added again.

#### Scenario: Replaces shifts
- **WHEN** two of five selected days have a shift
- **THEN** the panel says that two existing entries are replaced

#### Scenario: Range in another month
- **WHEN** the selection reaches into a month that is not displayed
- **THEN** its shifts and absences are counted too

#### Scenario: Already unavailable
- **WHEN** Unavailable is on and one selected day is already unavailable
- **THEN** the panel says it is skipped and no second entry is created for it

### Requirement: Adding the absence
Adding SHALL record the chosen type for every selected day: Unavailable as the employee's unavailability, Vacation and Sick as absent entries in the confirmed roster, each as before this change. Afterwards the mode SHALL end, the selection SHALL be cleared, and the calendar and the list SHALL show the new absence. A change to a published or locked month SHALL ask for a reason, or be refused, as any roster change does.

#### Scenario: Sick for three days
- **WHEN** a planner selects three days, turns on Sick and adds
- **THEN** each of the three days is an absent entry of type sick and the calendar shows them as sick

#### Scenario: Vacation replaces a shift
- **WHEN** a selected day holds a shift and the planner adds Vacation
- **THEN** the day becomes a vacation entry

#### Scenario: Locked month
- **WHEN** the selection touches a locked month and the planner is not an admin
- **THEN** it is refused and the reason is shown

### Requirement: Failure leaves a true picture
When adding fails for some or all days, the UI SHALL show the server's reason, SHALL reload the calendar and the list so they show exactly what was saved, and SHALL keep the selection and the type so the planner can try again.

#### Scenario: Partly saved
- **WHEN** the server refuses two of five days
- **THEN** the reason is shown, the calendar shows the three that were saved, and the selection is still there

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
