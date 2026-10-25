# planner-use-cases Specification

## Purpose
Remember which planner use case a tenant chose, so that what was selected is visible later instead of being guessed from the saved numbers.

## Requirements

### Requirement: Selected use case is stored
A tenant's planner settings SHALL hold the id of the selected use case, or none. A save SHALL store the id together with the values in the same request. An omitted id SHALL leave the stored one unchanged, and `null` SHALL clear it. An id SHALL be 1 to 40 lowercase letters, digits, hyphens or underscores; anything else SHALL be refused with 400 and change nothing. The id SHALL NOT change what the optimizer receives.

#### Scenario: Saved with the values
- **WHEN** a planner picks a use case and saves
- **THEN** reading the settings returns that id and the values the use case filled in

#### Scenario: Omitted keeps
- **WHEN** a save leaves out the use case
- **THEN** the stored use case is unchanged

#### Scenario: Null clears
- **WHEN** a save sends the use case as `null`
- **THEN** no use case is stored afterwards

#### Scenario: Invalid id
- **WHEN** a save sends the use case `Equal Share!`
- **THEN** the request is refused with 400 and nothing is changed

#### Scenario: Not for viewers
- **WHEN** a `shift-viewer` tries to save a use case
- **THEN** the request is refused and the stored use case is unchanged

### Requirement: Selection shown from the stored value
The planner settings page SHALL mark the use case that is stored and SHALL say so: *use case: X* while the values still equal that use case's, and *based on X, N settings changed* once they differ. A planner SHALL be able to clear the selection, which the page then calls custom. A stored id the page does not know SHALL be shown as custom. Picking a use case SHALL write its values into the form as before and SHALL select it, and nothing SHALL be saved until the planner saves.

#### Scenario: Remembered across visits
- **WHEN** a planner picks Equal share, saves, and opens the page again
- **THEN** Equal share is marked as the selected use case

#### Scenario: Fine-tuned
- **WHEN** a planner changes three values after picking Equal share
- **THEN** the page says it is based on Equal share with 3 settings changed, and Equal share stays marked

#### Scenario: Cleared
- **WHEN** a planner who has fine-tuned a use case's values clears the selection and saves
- **THEN** the page shows custom, no use case is stored, and it is still custom on the next visit

#### Scenario: Cleared while the values still match
- **WHEN** a planner clears the selection but the values still equal a use case's exactly
- **THEN** the page shows custom until it is left, and on the next visit shows that use case again, as for any tenant that has none stored

#### Scenario: Not saved yet
- **WHEN** a planner picks a use case and leaves without saving
- **THEN** the stored use case is unchanged

### Requirement: Tenants without a stored use case
When no use case is stored, the page SHALL treat a form whose values exactly equal a use case's as having selected it, and SHALL store that id the next time the settings are saved. Otherwise it SHALL show custom.

#### Scenario: Existing ward on a template's values
- **WHEN** a tenant that never stored a use case has exactly the Balanced values
- **THEN** the page shows Balanced as selected, and saving stores `balanced`

#### Scenario: Existing ward on its own values
- **WHEN** the values match no use case
- **THEN** the page shows custom and saving stores none

### Requirement: Change recorded
A change of the selected use case SHALL appear in the audit log with the settings change, under a readable field name.

#### Scenario: Audit entry
- **WHEN** a planner changes the use case from Balanced to Staff wellbeing and saves
- **THEN** the audit entry for the settings shows the use case as changed
