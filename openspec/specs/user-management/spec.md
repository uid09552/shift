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
