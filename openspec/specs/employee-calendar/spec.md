# employee-calendar Specification

## Purpose
Decides which employee the employee calendar opens with, so a user does not have to pick the same person again on every visit and lands on their own calendar after logging in.

## Requirements

### Requirement: Remembered employee
The employee calendar SHALL remember the employee last chosen in its picker in the browser, together with the account that chose it, and SHALL preselect that employee on the next visit by the same account in the same browser. Choosing the empty option SHALL forget the choice. A remembered employee who no longer exists SHALL be ignored.

#### Scenario: Back on the page
- **WHEN** a planner chose Anna, left the page and opens the employee calendar again
- **THEN** Anna is selected and her month is loaded

#### Scenario: Picker cleared
- **WHEN** a planner chooses the empty option and opens the page again later
- **THEN** no employee is selected, unless the own-employee rule applies

#### Scenario: Employee deleted
- **WHEN** the remembered employee has been deleted
- **THEN** the remembered choice is dropped and the page continues as if there were none

#### Scenario: Storage unavailable
- **WHEN** the browser refuses access to its storage
- **THEN** the page works as before, without remembering

### Requirement: Own employee after login
Right after a new login the employee calendar SHALL preselect the logged-in user's own employee, matched by the e-mail of the user's identity, and SHALL remember it as the new choice. A login counts as new when the remembered choice was cleared by logging out or belongs to another account. Without a matching employee the picker SHALL stay empty.

#### Scenario: After logging in
- **WHEN** a user whose e-mail belongs to employee Ben logs out, logs in and opens the employee calendar
- **THEN** Ben is selected, even if another employee was chosen before logging out

#### Scenario: Another account in the same browser
- **WHEN** a planner chose Anna and a different user, employee Carl, logs in in the same browser
- **THEN** Carl is selected, not Anna

#### Scenario: No employee record
- **WHEN** the logged-in user has no employee with their e-mail
- **THEN** no employee is selected and the hint to select one is shown

#### Scenario: Same session, later visit
- **WHEN** Ben, still logged in, chose Anna and opens the page again
- **THEN** Anna is selected, not Ben

### Requirement: Address wins
An employee named in the page's address SHALL be selected regardless of the remembered choice and of the own employee, and SHALL become the remembered choice.

#### Scenario: Link to an employee
- **WHEN** a planner who last chose Anna opens a link to the employee calendar for Dora
- **THEN** Dora is selected and is remembered as the last choice
