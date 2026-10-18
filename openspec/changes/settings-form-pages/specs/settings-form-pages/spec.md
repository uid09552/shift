## ADDED Requirements

### Requirement: Forms are pages
Adding or editing a shift, workstation, capability, employee or user SHALL happen on a page of its own with its own URL, not in a form shown above the list.

#### Scenario: Add
- **WHEN** a planner chooses Add on the Shifts list
- **THEN** the browser navigates to the new-shift form page and the list is not shown on it

#### Scenario: Edit from the list
- **WHEN** a planner double-clicks a row or chooses Edit in its menu
- **THEN** the edit form page for that item opens, filled with its values

#### Scenario: Deep link and reload
- **WHEN** an edit form page is reloaded or opened from a link
- **THEN** it loads the item and shows the same form

#### Scenario: Unknown item
- **WHEN** the id in the address does not exist
- **THEN** the page says the item was not found and offers a way back to the list

### Requirement: Save and cancel return to the list
Saving SHALL return to the list with the item visible and a confirmation; Cancel and the browser's Back SHALL return without saving. A failed save SHALL keep the form open with the error shown and the input intact.

#### Scenario: Save
- **WHEN** a valid form is saved
- **THEN** the list opens and shows the new or changed item

#### Scenario: Server rejects
- **WHEN** the backend refuses the save
- **THEN** the form stays open with the message and the entered values

### Requirement: Unsaved changes
Leaving a form page with changed, unsaved values SHALL ask for confirmation first.

#### Scenario: Cancel after typing
- **WHEN** a user changes a field and presses Cancel
- **THEN** a confirmation is shown, and only confirming discards the changes

#### Scenario: Untouched form
- **WHEN** a user leaves a form they did not change
- **THEN** no confirmation is shown

### Requirement: Consistent form layout
All form pages SHALL share one layout: title and subtitle, the fields, a validation summary, and Save and Cancel in an action bar that stays visible while the form scrolls.

#### Scenario: Long form
- **WHEN** a form is taller than the screen
- **THEN** Save and Cancel remain reachable without scrolling to the bottom

### Requirement: Access
Form pages SHALL be open to the roles that may write the item today; others are sent to the list. The Users form stays admin-only.

#### Scenario: Viewer opens a link
- **WHEN** a `shift-viewer` opens a form URL
- **THEN** they are redirected to the list
