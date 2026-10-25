# Spec Delta

## ADDED Requirements

### Requirement: Result belongs to the requesting tenant
A planning result SHALL be stored for the tenant that requested the plan, and that tenant's task SHALL be completed with it, whichever tenant the server is configured with by default. No other tenant SHALL see the task or the result.

#### Scenario: Second tenant plans
- **WHEN** a tenant other than the server's default tenant requests a plan and the solver answers
- **THEN** the task is `completed` for that tenant, its result is listed among that tenant's results, and the default tenant sees neither

#### Scenario: Failed run in a second tenant
- **WHEN** the solver reports an error for such a run
- **THEN** that tenant's task is `failed` with the message
