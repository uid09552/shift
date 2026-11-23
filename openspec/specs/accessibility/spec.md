# accessibility Specification

## Purpose
The app is usable with a keyboard and a screen reader, and readable in both themes, to WCAG 2.1 AA.

## Requirements

### Requirement: Dialogs
Every dialog SHALL move focus into itself when it opens, keep Tab inside, close on Escape (the topmost one only) and return focus to where it was.

### Requirement: Names and structure
Icon-only buttons and unlabelled form controls SHALL have accessible names. Calendar grids SHALL be tables with a caption, column headers and row headers. A shift SHALL be told apart by its code, not by colour alone.

### Requirement: Automated checks
Automated axe-core checks SHALL find nothing critical or serious on Overview, Schedule, Scheduler, Employees and Settings, in the light and the dark theme; colour contrast SHALL be checked on the Schedule grid, the command palette and the dialogs.

#### Scenario: Regression
- **WHEN** a change adds an unlabelled icon button to one of those pages
- **THEN** the unit test run fails and names the element
