# roster-publication Specification

## Purpose
Gives each calendar month of a tenant's confirmed roster a status (draft, published, locked) that decides who sees it, who may change it, and when a change has to be justified.

## Requirements

### Requirement: Month status
Each calendar month of a tenant's confirmed roster SHALL have exactly one status: `draft`, `published` or `locked`. A month without a recorded status SHALL be `draft`. Statuses SHALL NOT be visible or changeable across tenants.

#### Scenario: Unplanned month
- **WHEN** the status of a month nobody has touched is read
- **THEN** it is `draft`

#### Scenario: Other tenant
- **WHEN** a user reads or changes month statuses
- **THEN** only their own tenant's months are affected or returned

### Requirement: Publishing
A `shift-planner` or `shift-admin` SHALL be able to publish a `draft` month, which records who published it and when. A `shift-viewer` SHALL NOT change any month status.

#### Scenario: Planner publishes
- **WHEN** a planner publishes a draft month
- **THEN** its status becomes `published` with the publisher and timestamp recorded

#### Scenario: Viewer publishes
- **WHEN** a viewer attempts to publish a month
- **THEN** the request is refused

#### Scenario: Publishing twice
- **WHEN** a planner publishes a month that is already `published` or `locked`
- **THEN** the request is refused as a conflict and nothing changes

### Requirement: Automatic locking
A `published` month SHALL become `locked` once its last day has passed, unless an admin unlocked it. Months still in `draft` SHALL NOT lock automatically. A `shift-admin` MAY lock a published month whose last day has passed.

#### Scenario: Month ends
- **WHEN** the status of a published month is read after its last day
- **THEN** it is `locked`

#### Scenario: Draft month ends
- **WHEN** a month that was never published has passed
- **THEN** it stays `draft`

### Requirement: Reverting a status
Only a `shift-admin` SHALL be able to unpublish a month (`published` → `draft`) or unlock it (`locked` → `published`), and SHALL give a non-empty reason, which is written to the audit log. An unlocked month SHALL stay `published` until a `shift-admin` locks it again by hand.

#### Scenario: Admin unlocks
- **WHEN** an admin unlocks a locked month with a reason
- **THEN** its status becomes `published` and the audit log records the reason

#### Scenario: Unlocked month stays open
- **WHEN** the status of a past month an admin unlocked is read
- **THEN** it is `published` until an admin locks it

#### Scenario: No reason
- **WHEN** an admin unpublishes or unlocks without a reason
- **THEN** the request is refused

#### Scenario: Planner unlocks
- **WHEN** a planner attempts to unpublish or unlock a month
- **THEN** the request is refused

### Requirement: Draft visibility
A `shift-viewer` SHALL see confirmed roster entries only for `published` and `locked` months, in every endpoint that returns them. Planners and admins SHALL see all months.

#### Scenario: Viewer reads a draft month
- **WHEN** a viewer lists confirmed shifts for a range that includes a draft month
- **THEN** no entries of that month are returned

#### Scenario: Planner reads a draft month
- **WHEN** a planner lists the same range
- **THEN** the draft entries are returned

### Requirement: Editing by status
Every write to the confirmed roster SHALL follow the status of each month it touches. This covers manual edits, taking a proposal as plan, recorded absences, approved swaps and replacements. In `draft` and `published` months, planners and admins MAY write. In a `locked` month only a `shift-admin` MAY write, with a non-empty reason. A write that touches several months SHALL be refused completely if any one of them refuses it.

#### Scenario: Planner edits a locked month
- **WHEN** a planner changes a confirmed shift in a locked month
- **THEN** the change is refused and the roster is unchanged

#### Scenario: Admin edits a locked month
- **WHEN** an admin changes a confirmed shift in a locked month and gives a reason
- **THEN** the change is saved

#### Scenario: Mixed months
- **WHEN** a write spans a published month and a locked month and the caller is a planner
- **THEN** nothing is written

### Requirement: Freeze window
Each tenant SHALL have a `freeze_days` setting (default 7, 0 = off). A write in a `published` month to a day from today up to today + `freeze_days` − 1 SHALL require a non-empty reason. Without one it SHALL be refused.

#### Scenario: Change inside the window
- **WHEN** a planner changes tomorrow's shift in a published month without a reason
- **THEN** the change is refused with a message asking for a reason

#### Scenario: Change with reason
- **WHEN** the same change is made with a reason
- **THEN** it is saved and the reason is kept with the change

#### Scenario: Draft month inside the window
- **WHEN** a planner changes tomorrow's shift in a draft month
- **THEN** no reason is required

### Requirement: Publish deadline
Each tenant SHALL have a `publish_lead_days` setting (default 28). A `draft` month whose first day is less than `publish_lead_days` days away SHALL be reported as due, and SHALL be reported as overdue once its first day is reached. The deadline SHALL NOT block or publish anything. It SHALL be shown to planners and admins on the dashboard and the Schedule page.

#### Scenario: Month due soon
- **WHEN** the next month is in draft and starts in 20 days with `publish_lead_days` 28
- **THEN** planners see that it is due for publishing

#### Scenario: Published month
- **WHEN** the month is already published
- **THEN** no deadline warning is shown for it

### Requirement: Existing rosters on upgrade
Months that already contain confirmed roster entries when this capability is introduced SHALL start as `published`. Months that have already passed SHALL start as `locked`.

#### Scenario: Upgrade
- **WHEN** the system is upgraded with roster entries in the current and the next month
- **THEN** both months are `published` and viewers still see them
