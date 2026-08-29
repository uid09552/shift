# REST API

Base URL: `http://localhost:8080/api/v1` (`8081` when running through
`deploy/docker-compose.yml`, `/api/v1` behind the gateway).

The full contract lives in
[`api/openapi.yaml`](https://gitlab.com/uid09552/shift/-/blob/main/api/openapi.yaml)
— 66 operations, and the same file the MCP server is generated from. This page
is the map; the spec is the territory.

## Conventions

- JSON in, JSON out; `Content-Type: application/json` except on the
  multipart import endpoints.
- Identifiers are UUIDs.
- Dates are `YYYY-MM-DD`, times are `HH:MM:SS`, timestamps are ISO 8601.
- Every request must resolve to a tenant — an `x-access-token` JWT with a
  `tenant` claim, or dev mode. See [Auth & Multi-Tenancy](auth.md).
- Errors: `400` validation (with a message), `401` unresolved tenant, `404` not
  found, `500` internal.

## Health and identity

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness — outside `/api/v1`, no auth |
| `GET` | `/api/v1/self` | Current user, decoded from the gateway's `X-Userinfo` header |

## Employees

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/employees` | List / create |
| `GET` `PUT` `DELETE` | `/employees/{id}` | Read / update / delete |
| `GET` | `/employees/email/{email}` | Look up by email |
| `GET` | `/employees/template` | XLSX import template |
| `POST` | `/employees/import` | Bulk import (multipart) |
| `GET` `POST` | `/employees/{id}/capabilities` | List / grant a capability |
| `GET` `POST` | `/employees/{id}/available-shifts` | List / add a workable shift |
| `GET` `POST` | `/employees/{id}/shift-assignments` | Fixed assignments |
| `GET` `POST` | `/employees/{id}/confirmed-shift-plans` | Confirmed plan rows |

## Shifts

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/shifts` | List / create |
| `GET` `PUT` `DELETE` | `/shifts/{id}` | Read / update / delete |
| `POST` | `/shifts/{id}/weekday-times` | Set times, staffing band and rest days for a weekday |
| `DELETE` | `/shifts/{id}/weekday-times/{weekday}` | Remove a weekday — the shift stops running that day |
| `GET` | `/shifts/template` | XLSX template |
| `POST` | `/shifts/import` | Bulk import |

## Capabilities

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/capabilities` | List / create |
| `GET` `PUT` `DELETE` | `/capabilities/{id}` | Read / update / delete |
| `GET` | `/capabilities/template` | XLSX template |
| `POST` | `/capabilities/import` | Bulk import |

## Workstations

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/workstations` | List / create |
| `GET` `PUT` `DELETE` | `/workstations/{id}` | Read / update / delete |
| `PUT` | `/workstations/{id}/availability` | Set availability |
| `PATCH` | `/workstations/{id}/enable` | Include in planning |
| `PATCH` | `/workstations/{id}/disable` | Exclude from planning |
| `GET` `POST` | `/workstations/{id}/required-capabilities` | List / add a requirement |
| `GET` `POST` | `/workstations/{id}/unavailabilities` | Closure ranges |
| `GET` `DELETE` | `/workstations/{id}/unavailabilities/{uid}` | Read / remove a closure |
| `GET` | `/workstations/template` | XLSX template |
| `POST` | `/workstations/import` | Bulk import |

## Unavailabilities

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/unavailabilities` | List / create |
| `GET` `DELETE` | `/unavailabilities/{id}` | Read / delete |

A row with `shift_id` blocks one shift; without it, the whole day.
`is_soft_preference: true` makes it a penalised preference rather than a hard
block.

## Shift wishes

A shift wish is an employee's request to work a particular shift on a particular
date — a soft reward for the optimizer, never a guarantee.

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/shift-wishes` | List (`employee_id`, `from_date`+`to_date`) / create |
| `GET` `DELETE` | `/shift-wishes/{id}` | Read / delete |
| `GET` `PUT` | `/wish-settings` | Read / set the wish window (**`PUT` needs `shift-admin`**) |

`shift-planner` and `shift-admin` manage anyone's wishes. A `shift-viewer` may
only manage their own — the employee's e-mail must match the `email` or
`preferred_username` claim of their token. The wish window below applies on top
of that, to everyone.

### The wish window

`/wish-settings` is one row per tenant with three states:

| `mode` | Wishes may be placed |
|---|---|
| `enabled` | for any date |
| `disabled` | not at all |
| `date_range` | only for dates in `[window_start, window_end]`, both inclusive |

```bash
curl -X PUT http://localhost:8081/api/v1/wish-settings \
  -H "Content-Type: application/json" \
  -d '{
        "mode": "date_range",
        "window_start": "2026-10-01",
        "window_end": "2026-10-31"
      }'
```

`date_range` requires both dates; `window_start` must not be after `window_end`.
The dates are kept when another mode is active, so switching back to
`date_range` does not lose them — send `null` to clear them.

A wish the window refuses fails with **403** and the reason in `error` ("Shift
wishes are currently closed", or the dates it allows). The same check applies to
deleting a wish, keyed on the wish's own date — so a wish placed while the window
was open cannot be withdrawn after it closed.

!!! warning "The window binds every role"
    A closed window is a lock, not a self-service policy: `shift-planner` and
    `shift-admin` are refused exactly like everyone else. An admin who needs to
    change a wish re-opens the window first, which is itself audit-logged
    (`wish_settings.update`). Roles still decide *whose* wishes a caller may
    touch; the window decides *whether anyone* may.

Only `shift-admin` may change the window: a `shift-planner` gets 403 from the
handler, a `shift-viewer` from the role middleware.

## Planner

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

### Triggering a plan

```bash
curl -X POST http://localhost:8081/api/v1/planner/plan \
  -H "Content-Type: application/json" \
  -d '{
        "start_date": "2026-08-01",
        "end_date": "2026-08-31",
        "employee_ids": null
      }'
# {"task_id":"7b3f…"}
```

`employee_ids` narrows the run to a subset; omit or null it to plan everyone.
`monthly_hours_target_weight` may be passed to override that one weight for a
single run without changing stored settings.

Then poll:

```bash
curl http://localhost:8081/api/v1/planner/plan/7b3f…/status
# {"task_id":"7b3f…","status":"running"}
```

And adopt the outcome:

```bash
curl -X POST http://localhost:8081/api/v1/planner/optimized-shifts/<result_id>/take-as-plan
```

## Confirmed shift plans

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/confirmed-shift-plans` | List |
| `GET` `PUT` `DELETE` | `/confirmed-shift-plans/{id}` | Read / update / delete |
| `GET` `POST` | `/employees/{id}/confirmed-shift-plans` | Per-employee list / create |

## Shift assignments

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/employees/{id}/shift-assignments` | List / create |
| `DELETE` | `/shift-assignments/{id}` | Delete |

## Analysis

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/analysis/planned-hours-per-day-per-workstation` | Hours per workstation per day |
| `GET` | `/analysis/planned-employees-per-day-per-workstation` | Headcount per workstation per day |
| `GET` | `/analysis/staffing-per-day` | Who works each day, how many, and the split per shift |

All three read confirmed plans; the first two back the dashboard charts, all
over a required `from_date`/`to_date` range.

`staffing-per-day` differs from the per-workstation headcount in two ways that
matter: it counts **distinct employees**, including anyone rostered without a
workstation, so it is the day's actual headcount rather than a sum that
double-counts and omits; and it returns each person with their shift and
workstation **names** resolved. That is what lets a caller answer "how many
people work today" or "who is on nights" without joining three more lists — see
[Agent & MCP](agent.md#telling-the-time).

## Audit logs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/audit-logs` | Read the tenant's audit trail |

Write-only from the inside: entries are recorded by services, never accepted
over the API.

## Keeping the spec honest

`api/openapi.yaml` is not just documentation — the MCP server is generated from
it at startup. An endpoint missing from the spec is an endpoint the chat agent
cannot use, and one described wrongly is one the agent will call wrongly. Update
the spec in the same change as the route.
