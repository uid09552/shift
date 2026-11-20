# open-shifts Specification

## Purpose
A slot nobody is planned on is offered to the people who may take it. Qualified employees volunteer; a planner assigns one, which writes the roster.

## Requirements

### Requirement: Offering a slot
A planner or admin SHALL be able to offer a slot — a date (today or later), a shift and optionally a ward that runs it. A slot SHALL have at most one open offer. Planners MAY list the slots of the confirmed roster that are below their ward's minimum staffing and have no open offer.

#### Scenario: Offer
- **WHEN** a planner offers a future slot
- **THEN** an offer with status `open` is created

#### Scenario: Offered twice
- **WHEN** a slot that already has an open offer is offered
- **THEN** the request is refused with a conflict

#### Scenario: Gaps
- **WHEN** a planner asks for gaps in a period
- **THEN** every shift a ward runs below the ward's minimum is listed with how many are missing, except slots already offered and days the ward is closed

### Requirement: Who may take a slot
An employee MAY take a slot only if they are not already working or absent that day, have no hard unavailability for it, have the shift among their available shifts, hold the ward's required capabilities (or a higher level of the same skill group) and keep the planner's minimum rest to the shifts on the days around it. A planned day off SHALL NOT rule them out.

#### Scenario: Refusal lists every reason
- **WHEN** an employee who may not take the slot volunteers
- **THEN** the request is refused and the answer names every reason

#### Scenario: Seen by the employee
- **WHEN** an employee lists open shifts
- **THEN** each carries whether they may take it, and why not, and whether they volunteered — never who else did

#### Scenario: Planner cannot assign an ineligible employee
- **WHEN** a planner assigns an employee who may not take the slot
- **THEN** the request is refused with the reasons

### Requirement: Assigning
A planner or admin SHALL be able to assign an open offer to a volunteer or to anyone else who may take it. The shift SHALL be written into the employee's confirmed roster — replacing a planned day off — and the offer marked `filled` in one transaction, following the month's status like any roster write.

#### Scenario: Assign
- **WHEN** a planner assigns an eligible employee
- **THEN** the employee has the shift on that day and the offer is `filled`

#### Scenario: Inside the freeze window
- **WHEN** the day lies in a published month within the freeze window and no reason is given
- **THEN** nothing is written, the offer stays `open` and a reason is asked for

#### Scenario: Decided once
- **WHEN** an offer that is no longer open is assigned, closed or volunteered for
- **THEN** the answer is a conflict

### Requirement: Closing
A planner or admin SHALL be able to withdraw an open offer; the slot can then be offered again.
