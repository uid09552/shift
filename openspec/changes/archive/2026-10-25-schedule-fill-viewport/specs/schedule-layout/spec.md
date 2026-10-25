# schedule-layout Specification

## Purpose
Defines how the Schedule page uses the browser window, so that the schedule table is the only thing that scrolls and the page itself does not.

## ADDED Requirements

### Requirement: The Schedule page fills the window without page scrolling
On a window tall enough to show the toolbar and a usable table, the Schedule page SHALL be exactly as tall as the space below the app header, and the page itself SHALL NOT show a vertical scrollbar.

#### Scenario: Many employees
- **WHEN** the Schedule page shows more employee rows than fit the window
- **THEN** only the table area scrolls vertically, and the page does not

#### Scenario: Window is resized
- **WHEN** the window is made taller or shorter
- **THEN** the table area grows or shrinks to the remaining height with no page scrollbar appearing

#### Scenario: Toolbar wraps
- **WHEN** the toolbar wraps onto more lines because the window is narrower
- **THEN** the table area takes the smaller remaining height, and the page still does not scroll

### Requirement: One scroll area holds the table
The schedule table SHALL scroll horizontally and vertically inside a single scroll area, keeping the header row and the employee (or workstation or shift) column visible.

#### Scenario: Wide period
- **WHEN** the shown period is wider than the table area
- **THEN** the table scrolls horizontally inside its area while the names column stays visible

#### Scenario: Grouped views
- **WHEN** the planner switches to the grouped-by-workstation or grouped-by-shift view
- **THEN** the same single scroll area is used, with no extra scrollbar around the grid

#### Scenario: Day view
- **WHEN** the planner switches to the Day view
- **THEN** the chart scrolls inside the page frame and the page does not scroll

### Requirement: Small windows fall back to page scrolling
When the remaining height is below a usable minimum, the table area SHALL keep that minimum height and the page SHALL scroll normally instead.

#### Scenario: Very short window
- **WHEN** the window is too short to leave the table its minimum height
- **THEN** the table keeps its minimum height and the page scrolls to reach it
