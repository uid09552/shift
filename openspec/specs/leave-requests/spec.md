# leave-requests Specification

## Purpose
An employee asks for a date range off; a planner or admin decides. Approval turns the days into absences under the roster guard. Blackout periods refuse a request, per-capability limits only warn.

## Requirements

### Requirement: Requesting leave
A `shift-viewer` SHALL be able to request leave for themselves for a range of at most 366 days that does not start in the past. Planners and admins MAY NOT request leave; they decide on it. A request SHALL be refused when it touches a blackout period or overlaps the employee's own pending or approved leave.

#### Scenario: Request own leave
- **WHEN** an employee requests leave for a future range outside every blackout
- **THEN** a request is created with status `pending`

#### Scenario: Request for someone else
- **WHEN** an employee requests leave naming another employee
- **THEN** the request is refused

#### Scenario: Planner requests
- **WHEN** a planner or admin requests leave
- **THEN** the request is refused

#### Scenario: Blackout
- **WHEN** the range touches a blackout period
- **THEN** the request is refused and the answer names the period and its reason

#### Scenario: Overlap
- **WHEN** the employee already has pending or approved leave in the range
- **THEN** the request is refused with a conflict

### Requirement: Limits warn, never block
A limit states the most people holding a capability that may be absent on one day. A request that would exceed it SHALL still be created; the employee and whoever decides SHALL be shown which capability and days are affected, and approval SHALL NOT be refused for it.

#### Scenario: Over the limit
- **WHEN** a request would make more people with a limited capability absent on a day than allowed
- **THEN** the request is created with a warning naming the capability, the maximum and the days

#### Scenario: Approving over the limit
- **WHEN** a planner approves a request that carries a limit warning
- **THEN** it is approved and the warning is written to the audit entry

### Requirement: Approval writes absences under the roster guard
Approving a pending request SHALL, in one transaction, write a hard whole-day unavailability and its roster mirror for each day, following the month's status like any roster write. A day that already has a whole-day unavailability SHALL be left as it is; a day already marked with another absence SHALL keep its entry.

#### Scenario: Approve
- **WHEN** a planner approves a pending request
- **THEN** each day becomes an absence for the employee and the request is `approved`

#### Scenario: Inside the freeze window
- **WHEN** the days lie in a published month within the freeze window and no reason is given
- **THEN** nothing is written, the request stays `pending` and a reason is asked for

#### Scenario: Published month
- **WHEN** the days lie in a published month
- **THEN** each changed day becomes a change notice for the employee

#### Scenario: Decided once
- **WHEN** a request that is no longer pending is approved or rejected
- **THEN** the answer is a conflict

### Requirement: Revoking
A planner or admin SHALL be able to revoke an approved request. The absences the approval created SHALL be removed from today on; absences entered by hand or present before SHALL NOT be touched.

#### Scenario: Revoke
- **WHEN** a planner revokes an approved request
- **THEN** its absences from today on are removed and its status is `revoked`

### Requirement: The optimizer
Pending leave SHALL reach the optimizer as a soft preference to be off; approved leave is a hard absence.

#### Scenario: Pending
- **WHEN** the optimizer input is built while a request is pending
- **THEN** its days are in the employee's `preferred_off`, not in `unavailability`

### Requirement: Visibility
Employees SHALL see only their own requests; planners and admins SHALL see the tenant's. Blackout periods SHALL be readable by everyone; limits and the pending count only by planners and admins.
