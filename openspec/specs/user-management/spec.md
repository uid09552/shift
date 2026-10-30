# user-management Specification

## Purpose
Manage users and roles of a tenant, backed by Keycloak.

## Requirements

### Requirement: Tenant and roles
A tenant SHALL be a Keycloak organization; roles SHALL be `shift-admin`, `shift-planner` and `shift-viewer`.

#### Scenario: Role check
- **WHEN** roles are listed
- **THEN** only the three shift roles apply

### Requirement: Admin-only management
Only `shift-admin` SHALL list, add, delete users and replace roles, within their own organization.

#### Scenario: Non-admin
- **WHEN** a planner calls `/users`
- **THEN** the request is refused

### Requirement: Last-admin protection
An admin SHALL NOT remove `shift-admin` from themselves or remove themselves from the organization.

#### Scenario: Self-demotion
- **WHEN** an admin removes their own `shift-admin`
- **THEN** the request is refused

### Requirement: Unconfigured Keycloak
With no Keycloak URL configured, user endpoints SHALL answer 503.

#### Scenario: No Keycloak
- **WHEN** Keycloak is not configured
- **THEN** user endpoints return 503

### Requirement: Tenant isolation
Every record SHALL belong to a tenant and no request SHALL see another tenant's data.

#### Scenario: Other tenant
- **WHEN** a user requests another tenant's record
- **THEN** it is not found

### Requirement: Sign-in through Keycloak only
Users SHALL sign in and register only through Keycloak. The application SHALL NOT offer a sign-in or sign-up form of its own, and SHALL NOT link to one from its navigation.

#### Scenario: Navigation
- **WHEN** a signed-in user opens the sidebar
- **THEN** it has no sign-in or sign-up entry

#### Scenario: Old link
- **WHEN** a user opens `/signin` or `/signup`
- **THEN** the not-found page is shown and no credentials can be entered

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
