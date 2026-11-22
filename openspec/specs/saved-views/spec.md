# saved-views Specification

## Purpose
A planner who looks at the same slice of the roster every day (one ward, the ICU nurses, next month) keeps it as a named view, and the Schedule page opens that way on any device.

## Requirements

### Requirement: Views per user
A user SHALL be able to save the Schedule page's current filters — view (day/week/month), lens, wishes, workstations, capabilities and people — under a name. Views SHALL be stored on the server per user, so they follow the user across devices. A name SHALL be unique per user and page, regardless of case. Someone else's private view SHALL be neither listed nor reachable.

#### Scenario: Save and list
- **WHEN** a user saves the filters as "ICU nights"
- **THEN** their list of views holds it, and another user's does not

#### Scenario: Name taken
- **WHEN** a user saves a second view called "icu NIGHTS"
- **THEN** it is refused with the reason

### Requirement: Default and last-used view
Each user SHALL be able to mark one view per page as their default. Opening the Schedule page SHALL apply the default view, or else the one the user applied last. A link that names a view, month or day SHALL win over it.

#### Scenario: Restore
- **WHEN** a user with a default view opens the Schedule page
- **THEN** the grid shows that view's filters

#### Scenario: Link wins
- **WHEN** the page is opened from a link to a month
- **THEN** that month is shown and the default view is not applied

### Requirement: Sharing
Planners and admins SHALL be able to share a view with everyone in the organization; viewers SHALL NOT. Anyone may apply a shared view or make it their default. Only its owner, or an admin, SHALL change or delete a shared view. A view that is no longer shared SHALL stop being anyone else's default.

#### Scenario: Unshare
- **WHEN** a planner stops sharing a view a viewer had as default
- **THEN** the viewer's page opens without it
