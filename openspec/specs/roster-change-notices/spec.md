# roster-change-notices Specification

## Purpose
Tells every employee when their shifts in an already published roster change, what changed, who changed it, and why, and lets them confirm they have seen it.

## Requirements

### Requirement: A notice per change
Every write to a `published` or `locked` month that changes an employee's confirmed entry for a day SHALL create one notice for that employee and day. The notice SHALL hold the date, the previous and new shift, workstation and absence, the source of the change, the actor, the time, and the reason when one was given. The source SHALL be one of: manual, take as plan, absence, swap or replacement. Writes to `draft` months SHALL NOT create notices.

#### Scenario: Planner moves a shift
- **WHEN** a planner changes an employee's published shift from Early to Late
- **THEN** that employee gets a notice showing Early → Late, the planner, and the time

#### Scenario: Swap approved
- **WHEN** a swap between two employees is approved in a published month
- **THEN** each of the two gets a notice for each of their changed days

#### Scenario: Draft month
- **WHEN** a planner edits a draft month
- **THEN** no notice is created

### Requirement: No notice without a change
A write that leaves an employee's entry for a day exactly as it was SHALL NOT create a notice. Taking a proposal as plan into a published month SHALL create notices only for the days that differ from the roster it replaces.

#### Scenario: Re-taking an identical plan
- **WHEN** a proposal is taken as plan into a published month and only 3 entries differ
- **THEN** exactly 3 notices are created

### Requirement: Own notices
An employee SHALL be able to list their own notices, newest first, and see how many they have not acknowledged. A `shift-viewer` SHALL see only notices about themselves.

#### Scenario: Viewer lists notices
- **WHEN** a viewer opens "Changes to my shifts"
- **THEN** only notices about them are shown, newest first

#### Scenario: Unread count
- **WHEN** a viewer has 2 unacknowledged notices
- **THEN** the header bell shows 2

### Requirement: Acknowledging
An employee SHALL be able to acknowledge one or all of their own notices, which records the time. Nobody SHALL acknowledge a notice on another employee's behalf.

#### Scenario: Acknowledge all
- **WHEN** a viewer acknowledges all their notices
- **THEN** their unread count becomes 0 and each notice keeps its acknowledgement time

#### Scenario: Someone else's notice
- **WHEN** a user acknowledges a notice about a different employee
- **THEN** the request is refused

### Requirement: Planner overview
Planners and admins SHALL be able to list all notices of the tenant, filtered by employee, date range and acknowledgement state. This lets them see who has not yet seen a change.

#### Scenario: Unacknowledged changes for tomorrow
- **WHEN** a planner filters notices for tomorrow that are not acknowledged
- **THEN** every such notice is listed with the employee's name

### Requirement: Notices outlive edits
A notice SHALL stay unchanged when the roster entry it describes is changed again or deleted. A later change SHALL create its own notice.

#### Scenario: Two changes the same day
- **WHEN** a planner changes an employee's published shift twice
- **THEN** the employee has two notices, in order, each describing one step
