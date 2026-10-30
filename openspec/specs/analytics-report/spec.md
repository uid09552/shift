# analytics-report Specification

## Purpose
The Analytics page under Reports: an interactive report where planners and admins filter, chart, cross-check and search the ward's roster, absences, roster changes, audit activity and planning runs over time.

## Requirements

### Requirement: Access
The Analytics page and its menu entry under Reports SHALL be available to `shift-planner` and `shift-admin`. A `shift-viewer` SHALL see neither. Opening the page's address as a viewer SHALL redirect to the overview without loading any analytics data.

#### Scenario: Viewer opens the address
- **WHEN** a viewer opens `/analytics`
- **THEN** they land on the overview and no analytics request is made

#### Scenario: Planner menu
- **WHEN** a planner opens the Reports menu group
- **THEN** it lists Analytics next to the network page

### Requirement: Global filters
The page SHALL have one filter bar that applies to every chart and the detail table. It offers:
- a period, as a preset (this month, last month, this quarter, last 3 months, last 12 months) or a custom range of at most one year;
- workstations, shifts, employees and capabilities;
- absence types and change sources.

The default is the last 3 months with no other filter.

#### Scenario: Filter by workstation
- **WHEN** the planner selects workstation "ICU"
- **THEN** every chart and the detail table show only rows for ICU

#### Scenario: Capability filter
- **WHEN** the planner selects capability "Intensive Care"
- **THEN** only employees holding that capability are counted

### Requirement: Filter state in the address
The page SHALL keep the period, filters, chart selections and active tab in the page address. Reloading or opening a copied address SHALL restore the same view.

#### Scenario: Shared link
- **WHEN** a planner copies the address of a filtered view and an admin opens it
- **THEN** the admin sees the same period, filters, selection and tab

### Requirement: Cross-filtering
Selecting a chart element (a bar, slice, heatmap cell or line point) SHALL narrow every other chart and the detail table to it. The selection is added as a removable chip next to the filters. Selecting the same element again or removing its chip SHALL undo it, and a "clear all" control SHALL remove every selection and filter.

#### Scenario: Click a heatmap day
- **WHEN** the planner clicks 14 March in the coverage heatmap
- **THEN** the other charts and the detail table show 14 March only, and a "14 March" chip appears

#### Scenario: Remove chip
- **WHEN** the planner removes the chip
- **THEN** the page returns to the view before the click

### Requirement: Staffing and coverage analysis
The *Staffing & coverage* tab SHALL show:
- head count per day against the summed minimum per day;
- a calendar heatmap of each day's shortfall;
- shortfall by shift and by workstation;
- the days a shift or workstation went over its maximum.

Days on which a workstation was closed SHALL NOT count against that workstation's minimum. Months that are still drafts SHALL be marked as such.

#### Scenario: Short weekend
- **WHEN** a shift needs 2 people on Saturdays and 1 was rostered
- **THEN** that Saturday shows a shortfall of 1 for that shift

#### Scenario: Closed workstation
- **WHEN** a workstation was closed for a week
- **THEN** no shortfall is counted for it in that week

### Requirement: Hours and fairness analysis
The *Hours & fairness* tab SHALL show, per employee and over time:
- worked hours against the target, prorated from weekly target hours × days ÷ 7;
- nights, weekend days and holiday shifts;
- the team's spread (lowest, median, highest) for each.

Its per-employee totals SHALL equal the Fairness page's for the same period and employees.

#### Scenario: Consistent with Fairness
- **WHEN** the same period is shown on the Fairness page and in this tab
- **THEN** each employee's nights, weekends and hours are the same in both

### Requirement: Absence analysis
The *Absences* tab SHALL show absence days by type over time, by employee and by weekday. Clicking a type SHALL filter the page to it.

#### Scenario: Monday sickness pattern
- **WHEN** the planner selects absence type sick
- **THEN** the weekday chart shows the sick days per weekday for the filtered period

### Requirement: Roster change analysis
The *Roster changes* tab SHALL show:
- change notices over time by source;
- the employees and workstations with the most changes;
- the actors who made them;
- the share made with a reason;
- the time until acknowledgement, including how many are still unacknowledged.

#### Scenario: Unacknowledged changes
- **WHEN** 5 notices in the period have not been acknowledged
- **THEN** the tab shows 5 unacknowledged

### Requirement: Audit activity analysis
The *Audit activity* tab SHALL show audit entries over time by action, item type and actor. From any group, the planner SHALL be able to open the Audit log page filtered to that group's action, item type, actor and dates.

#### Scenario: Drill to the Audit log
- **WHEN** the planner opens the group "workstation.delete by anna" from the tab
- **THEN** the Audit log page opens filtered to that action, actor and period, listing exactly the counted entries

### Requirement: Planning run analysis
The *Planning runs* tab SHALL show runs over time by source and status, their duration, and the solver outcomes. For automatic runs it SHALL show how many became the roster and how many stayed a proposal.

#### Scenario: Auto plan kept as proposal
- **WHEN** three automatic runs finished and one of them had a solver message
- **THEN** the tab shows 2 taken as roster and 1 kept as a proposal

### Requirement: Detail table and search
Below the charts, the page SHALL show the rows behind the current tab, filters and selection, with sortable columns, paging and a text search over names, actions and reasons. The visible rows SHALL be exportable as CSV, in the filtered and searched state.

#### Scenario: Search in changes
- **WHEN** the planner types "Krank" on the Roster changes tab
- **THEN** the table shows only notices whose reason, employee or actor contains "Krank"

#### Scenario: CSV export
- **WHEN** the planner exports the table
- **THEN** the CSV holds exactly the rows the table shows, with the same columns

### Requirement: Chart export and accessibility
Every chart SHALL be exportable as a PNG. Every chart SHALL have a textual title. Every chart SHALL have a summary that a screen reader can read, giving its key figures. The page SHALL follow the app's light and dark theme.

#### Scenario: Dark theme
- **WHEN** the user switches the app to dark mode
- **THEN** the charts redraw with dark-theme colours without reloading data

### Requirement: Loading, error and empty states
Each tab SHALL show that it is loading while its data loads. If loading fails, it SHALL show the load-error message with Retry, and SHALL NOT show empty charts. If the period holds no data, it SHALL say so instead of drawing empty axes.

#### Scenario: Endpoint fails
- **WHEN** the roster facts request fails
- **THEN** the affected tabs show "could not be loaded" with Retry, and no zero-valued charts

#### Scenario: No roster yet
- **WHEN** the period has no confirmed entries
- **THEN** the staffing tab says there is no confirmed roster in this period
