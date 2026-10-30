# Spec Delta

## ADDED Requirements

### Requirement: Caller identity
`GET /self` SHALL be part of the published API. It SHALL return the caller's roles, and their identity (subject, username, e-mail, name) from the gateway's user info. When that header is absent, it SHALL fall back to the access token's own claims. Any role may call it, and it never returns another user's data.

#### Scenario: Through the gateway
- **WHEN** a signed-in user calls `GET /self` through the gateway
- **THEN** the answer holds their roles and identity

#### Scenario: Direct call without user info
- **WHEN** `GET /self` is called with a valid access token but no user-info header, as the MCP server does
- **THEN** roles, username and e-mail still come from the token's claims

### Requirement: Caller's employee
`GET /self` SHALL return `employee_id`: the caller's employee in their tenant, matched by e-mail or username the same way shift swaps identify the requester. It SHALL be null when nothing matches.

#### Scenario: Linked viewer
- **WHEN** a viewer whose e-mail matches an employee calls `GET /self`
- **THEN** `employee_id` is that employee's id

#### Scenario: Admin without an employee record
- **WHEN** an admin whose e-mail matches no employee calls `GET /self`
- **THEN** `employee_id` is null and the rest of the answer is unchanged
