---
type: API Surface
title: REST API
description: The backend's HTTP surface — conventions, every resource group, and the planner endpoints in detail.
resource: api/openapi.yaml
tags: [interfaces, rest, http, api]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: api/openapi.yaml
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: docs/api.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: src/server.rs
    author: human:maxrg
    last_modified: 2026-07-31
---

Base URL `http://localhost:8080/api/v1` (`8081` via `deploy/docker-compose.yml`,
`/api/v1` behind the gateway).

The full contract is `api/openapi.yaml` — and it is a **runtime input**, not just
documentation: the MCP server is generated from it. This concept is the map; the
spec is the territory. See
[Spec-driven tool surface](/architecture/spec-driven-tool-surface.md).

# Conventions

* JSON in, JSON out, except the multipart import endpoints.
* Identifiers are UUIDs.
* Dates `YYYY-MM-DD`, times `HH:MM:SS`, timestamps ISO 8601.
* Every request must resolve to a tenant — an `x-access-token` JWT with a
  `tenant` claim, or dev mode.
* Errors: `400` validation (with a message), `401` unresolved tenant, `403` role
  does not permit the method, `404` not found, `500` internal.

# Health and identity

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness — outside `/api/v1`, no auth |
| `GET` | `/api/v1/self` | Current user, decoded from the gateway's `X-Userinfo` |

# Employees

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/employees` | List / create |
| `GET` `PUT` `DELETE` | `/employees/{id}` | Read / update / delete |
| `GET` | `/employees/email/{email}` | Look up by email |
| `GET` `POST` | `/employees/template`, `/employees/import` | XLSX template / bulk import |
| `GET` `POST` | `/employees/{id}/capabilities` | List / grant a capability |
| `GET` `POST` | `/employees/{id}/available-shifts` | List / add a workable shift |
| `GET` `POST` | `/employees/{id}/shift-assignments` | Fixed assignments |
| `GET` `POST` | `/employees/{id}/confirmed-shift-plans` | Confirmed plan rows |

# Shifts

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/shifts` | List / create |
| `GET` `PUT` `DELETE` | `/shifts/{id}` | Read / update / delete |
| `POST` | `/shifts/{id}/weekday-times` | Set times, staffing band and rest days for a weekday |
| `DELETE` | `/shifts/{id}/weekday-times/{weekday}` | Remove a weekday — the shift stops running that day |
| `GET` `POST` | `/shifts/template`, `/shifts/import` | XLSX |

# Capabilities

`GET`/`POST /capabilities`, `GET`/`PUT`/`DELETE /capabilities/{id}`, plus
`/capabilities/template` and `/capabilities/import`.

# Workstations

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/workstations` | List / create |
| `GET` `PUT` `DELETE` | `/workstations/{id}` | Read / update / delete |
| `PUT` | `/workstations/{id}/availability` | Set availability |
| `PATCH` | `/workstations/{id}/enable` \| `/disable` | Include in / exclude from planning |
| `GET` `POST` | `/workstations/{id}/required-capabilities` | List / add a requirement |
| `GET` `POST` | `/workstations/{id}/unavailabilities` | Closure ranges |
| `GET` `DELETE` | `/workstations/{id}/unavailabilities/{uid}` | Read / remove a closure |
| `GET` `POST` | `/workstations/template`, `/workstations/import` | XLSX |

# Unavailabilities and wishes

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/unavailabilities` | List / create |
| `GET` `DELETE` | `/unavailabilities/{id}` | Read / delete |
| `GET` `POST` | `/shift-wishes` | List / create |
| `GET` `DELETE` | `/shift-wishes/{wishId}` | Read / delete |

An unavailability with `shift_id` blocks one shift; without it, the whole day.
`is_soft_preference: true` makes it a penalised preference rather than a hard
block — see [Unavailability](/concepts/unavailability.md).

# Planner

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/planner/plan` | Start an optimization run → `{ task_id }` |
| `GET` | `/planner/plan/{task_id}/status` | `running` / `completed` / `failed` |
| `POST` | `/planner/prepare` | Build the solver payload **without** solving |
| `GET` | `/planner/tasks` | List planning tasks |
| `GET` `DELETE` | `/planner/tasks/{id}` | Read / delete a task |
| `GET` | `/planner/optimized-shifts` | List results (`limit`, `offset`, `latest`) |
| `GET` `PUT` `DELETE` | `/planner/optimized-shifts/{id}` | Read / edit / delete a result |
| `POST` | `/planner/optimized-shifts/{id}/take-as-plan` | Promote a result to confirmed plan |
| `GET` `PUT` | `/planner-settings` | Read / update this tenant's solver settings |

`POST /planner/plan` requires a NATS connection; without one it fails with 500.

# Examples

```bash
curl -X POST http://localhost:8081/api/v1/planner/plan \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2026-08-01","end_date":"2026-08-31","employee_ids":null}'
# {"task_id":"7b3f…"}

curl http://localhost:8081/api/v1/planner/plan/7b3f…/status
# {"task_id":"7b3f…","status":"running"}

curl -X POST http://localhost:8081/api/v1/planner/optimized-shifts/<result_id>/take-as-plan
```

`employee_ids` narrows the run to a subset; omit or null it to plan everyone.
`monthly_hours_target_weight` may be passed to override that one weight for a
single run without changing stored settings.

# Confirmed plans, assignments, analysis, audit

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/confirmed-shift-plans` | List |
| `GET` `PUT` `DELETE` | `/confirmed-shift-plans/{id}` | Read / update / delete |
| `POST` | `/shift-assignments/import` | Bulk-create fixed assignments from a roster, matching people and shifts by name |
| `DELETE` | `/shift-assignments/{id}` | Delete a fixed assignment |
| `GET` | `/analysis/planned-hours-per-day-per-workstation` | Hours per workstation per day |
| `GET` | `/analysis/planned-employees-per-day-per-workstation` | Headcount per workstation per day |
| `GET` | `/audit-logs` | Read the tenant's audit trail |

`/shift-assignments/import` is the one write that takes names instead of ids —
it exists for importing a plan that already exists on paper, where nothing has
an id yet. Sent with `dry_run` it resolves everything and reports what it would
write without writing it, which is how the assistant shows its reading of an
uploaded file before the user accepts it.

The analysis endpoints read confirmed plans and back the dashboard charts. The
audit trail is write-only from inside: entries are recorded by services, never
accepted over the API.

# Related

* [Planning pipeline](/architecture/planning-pipeline.md)
* [XLSX import and export](/interfaces/xlsx-import-export.md)
* [Gateway and identity](/architecture/gateway-and-identity.md) - roles and the 403 rule
