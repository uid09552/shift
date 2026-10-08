## ADDED Requirements

### Requirement: Requesting a swap
A `shift-viewer` SHALL be able to request an exchange of one of their own confirmed shifts for one of a colleague's confirmed shifts. Planners and admins MAY NOT use the request flow on behalf of others. The system SHALL NOT validate qualification or other rules at request time.

#### Scenario: Request own shift
- **WHEN** a viewer requests a swap of their own confirmed shift with a colleague's confirmed shift
- **THEN** a request is created with status `pending_colleague`

#### Scenario: Request someone else's shift as owner
- **WHEN** a viewer requests a swap in which the offered shift belongs to another employee
- **THEN** the request is refused

#### Scenario: Shift not in roster
- **WHEN** either named shift does not exist in the confirmed roster, or its date has passed
- **THEN** the request is refused

#### Scenario: Unqualified colleague
- **WHEN** the colleague lacks a capability the offered shift's workstation requires
- **THEN** the request is still created

### Requirement: Colleague consent
The colleague SHALL accept or decline before a planner sees the request. Only the colleague named in the request MAY answer it, and the requester MAY cancel it while it is pending.

#### Scenario: Colleague accepts
- **WHEN** the named colleague accepts a `pending_colleague` request
- **THEN** its status becomes `pending_planner`

#### Scenario: Colleague declines
- **WHEN** the named colleague declines
- **THEN** its status becomes `rejected` and the roster is unchanged

#### Scenario: Requester cancels
- **WHEN** the requester cancels a pending request
- **THEN** its status becomes `cancelled`

### Requirement: Planner decision
A `shift-planner` or `shift-admin` SHALL approve or reject requests in `pending_planner`. Approval SHALL exchange the two confirmed roster rows and record an audit entry. Rejection SHALL leave the roster unchanged.

#### Scenario: Approve
- **WHEN** a planner approves a `pending_planner` request
- **THEN** each employee holds the other's shift and the status becomes `approved`

#### Scenario: Roster changed meanwhile
- **WHEN** either shift was edited or removed since the request was made
- **THEN** approval is refused and the request is marked stale

#### Scenario: Viewer approves
- **WHEN** a viewer attempts to approve or reject
- **THEN** the request is refused

### Requirement: Rule warnings for the approver
For a request in `pending_planner` the system SHALL show the planner the rule violations the exchange would cause for both employees, covering rest, recovery, streaks, weekly cap, station maximum and personal limits. Violations SHALL be warnings only and SHALL NOT prevent approval.

#### Scenario: Warning shown
- **WHEN** the exchange would leave an employee below minimum rest
- **THEN** the review shows that warning and approval remains possible

### Requirement: Planner notification
The planner UI SHALL show a notification with the number of requests awaiting a planner decision, visible to `shift-planner` and `shift-admin` only.

#### Scenario: Planner sees notification
- **WHEN** a request enters `pending_planner`
- **THEN** a planner sees it in the notification

#### Scenario: Viewer sees none
- **WHEN** a viewer opens the UI
- **THEN** no planner notification is shown

### Requirement: Visibility
A viewer SHALL see only requests in which they are requester or colleague. Planners and admins SHALL see all requests of the tenant. No request SHALL be visible across tenants.

#### Scenario: Unrelated viewer
- **WHEN** a viewer lists swap requests
- **THEN** only their own are returned

### Requirement: Expiry
A request whose earlier shift date has passed without approval SHALL become `expired`.

#### Scenario: Date passes
- **WHEN** the shift date passes while the request is pending
- **THEN** its status becomes `expired` and the roster is unchanged

### Requirement: Roster only
A swap SHALL change only the confirmed roster and SHALL NOT affect optimizer input.

#### Scenario: Next plan
- **WHEN** a new plan is calculated after an approved swap
- **THEN** the swap has no influence on the solver beyond the confirmed roster history
