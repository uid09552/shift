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

## Role authorization map

The route-level permission rules are enforced centrally by the backend middleware
in `src/services/tenant.rs` and by a few endpoint-specific admin checks. The
summary below is the product contract for the API.

| Endpoint group | `shift-viewer` | `shift-planner` | `shift-admin` |
|---|---|---|---|
| Read-only data (`/employees`, `/shifts`, `/workstations`, `/analysis/*`, `/info`) | ✅ read | ✅ read/write | ✅ read/write |
| Write data (`POST/PUT/PATCH/DELETE` on master data) | ❌ | ✅ | ✅ |
| `/shift-wishes` | ✅ own records only | ✅ any record | ✅ any record |
| `/wish-settings` | ✅ read only | ✅ read only | ✅ read/write |
| `/shift-swaps` | ✅ request, answer, cancel — own only | ✅ read all, approve/reject | ✅ read all, approve/reject |
| `/leave-requests` | ✅ request, cancel — own only | ✅ read all, approve/reject/revoke | ✅ read all, approve/reject/revoke |
| `/leave-blackouts` | ✅ read only | ✅ read/write | ✅ read/write |
| `/leave-limits` | ❌ | ✅ read/write | ✅ read/write |
| `/open-shifts` | ✅ read, volunteer, withdraw — own only | ✅ read all, offer/assign/close | ✅ read all, offer/assign/close |
| `/notification-preferences` | ✅ own only | ✅ own only | ✅ own only |
| `/notification-outbox` | ❌ | ✅ read | ✅ read |
| `/users` and `/users/{id}/roles` | ❌ | ❌ | ✅ |
| `/planner/*` | ❌ | ✅ | ✅ |
| `/planner-settings` | ✅ read only | ✅ read/write | ✅ read/write |
| `/audit-logs` | ✅ read | ✅ read | ✅ read |

The grant model is intentionally simple:

- `shift-viewer`: read access everywhere, plus writes only on `shift-wishes`,
  `shift-swaps`, `leave-requests`, `open-shifts` (volunteering) and
  `notification-preferences` for the caller's own employee record.
- `shift-planner`: all write operations except the admin-only actions.
- `shift-admin`: everything above, plus user-management and wish-window changes.

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

### Contracted hours

An employee's hours are **per week** and optional. `weekly_working_hours` is
their own value — `null` follows the tenant's `default_weekly_working_hours`
(`/planner-settings`, 40 unless changed; planners and admins may change it), `0`
means no hours target. Every employee response also carries
`effective_weekly_working_hours`, the value that applies.

- Create: omit `weekly_working_hours` (or send `null`) to follow the default.
- Update: an absent key leaves it unchanged; `null` puts the employee back on
  the default.
- Values run from 0 to 168. A body still sending `monthly_working_hours` is
  refused with **400**; so is an import whose third column is the old
  `max_working_hours` / `monthly_working_hours` header. In the template, an
  empty hours cell means the default.

Wherever a target is needed for a period it is weekly hours × days ÷ 7: the
optimizer input (`employees[].weekly_working_hours`, already resolved), the
plan check, the replacement ranking and `/analysis/fairness`.

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

## Shift swaps

An employee offers one of their confirmed shifts for one of a colleague's; the
colleague accepts or declines, then a planner approves (the two roster rows are
exchanged) or rejects.

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/shift-swaps` | List (`status`; planners also `employee_id`) / request |
| `GET` | `/shift-swaps/pending-count` | How many await a planner (**planner/admin only**) |
| `GET` | `/shift-swaps/{id}` | Read — for a planner on a `pending_planner` request, with rule `warnings` |
| `POST` | `/shift-swaps/{id}/accept`, `/decline` | The colleague named in the request answers |
| `POST` | `/shift-swaps/{id}/cancel` | The requester withdraws it while pending |
| `POST` | `/shift-swaps/{id}/approve`, `/reject` | **`shift-planner` / `shift-admin`** decide |

```text
pending_colleague ─accept─▶ pending_planner ─approve─▶ approved
        │ decline                  │ reject
        ▼                          ▼
     rejected                   rejected        (either pending: cancel → cancelled,
                                                 earlier date passed → expired)
```

```bash
curl -X POST http://localhost:8081/api/v1/shift-swaps \
  -H "Content-Type: application/json" \
  -d '{ "requester_id": "<own employee id>", "requester_date": "2026-10-12",
        "colleague_id": "<colleague id>",    "colleague_date": "2026-10-13" }'
```

- **Who.** The requester must be the caller (matched by e-mail, as for wishes);
  planners and admins may not request swaps, so none skips the colleague's
  consent. Viewers see only requests they are part of; planners the tenant's.
- **What is checked at request time.** Both shifts must exist in the confirmed
  roster on those dates, today or later; on different dates each person must be
  free (no row, or a free day) on the other's date. Nothing else — qualification
  included.
- **Rule warnings.** The planner's view of a `pending_planner` request asks the
  agent (`POST /api/v1/roster/swap-check`, see [Agent](agent.md#shift-swap-check))
  which rules the exchange breaks for each person: rest, recovery, streaks,
  weekly cap, station maximum, personal limits, qualification. They come back as
  `warnings`, or the reason they could not be had as `warnings_error`. They never
  block approval; the ones present are written to the `shift_swap.approve` audit
  entry.
- **Approval** re-reads both roster rows in one transaction. Same day: each row
  takes the other's shift. Different days: the shift rows change owner, and so do
  the free-day rows they displace. If either shift was edited or removed since,
  nothing changes, the request becomes `stale` and the answer is **409**.
- **Expiry** is written on read: a pending request whose earlier date has passed
  becomes `expired`.

Every step leaves an audit entry (`shift_swap.create`, `.accept`, `.decline`,
`.cancel`, `.reject`, `.approve`, `.stale`). Swaps touch only the confirmed
roster; the optimizer sees them only as `history`.

## Leave requests

An employee asks for a date range off; a planner approves or rejects it.
Approving writes the days as absences; revoking takes them back.

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/leave-requests` | List (`status` comma-separated, `from`/`to` overlap; planners also `employee_id`) / request |
| `GET` | `/leave-requests/pending-count` | How many await a decision (**planner/admin only**) |
| `GET` | `/leave-requests/{id}` | Read — while pending, with limit `warnings` |
| `POST` | `/leave-requests/{id}/cancel` | The requester withdraws it while pending |
| `POST` | `/leave-requests/{id}/approve`, `/reject` | **`shift-planner` / `shift-admin`** decide; body `{"comment": "…"}` optional |
| `POST` | `/leave-requests/{id}/revoke` | **`shift-planner` / `shift-admin`** take an approved request back |
| `GET` `POST` | `/leave-blackouts` | Periods in which no leave can be requested (everyone reads, planners add) |
| `DELETE` | `/leave-blackouts/{id}` | Remove one (**planner/admin**) |
| `GET` `PUT` | `/leave-limits` | At most N people with a capability absent on one day; `PUT` replaces all (**planner/admin**) |

```text
pending ─approve─▶ approved ─revoke─▶ revoked
   │ reject            (pending: cancel → cancelled)
   ▼
rejected
```

- **Who.** The requester must be the caller (matched by e-mail); planners and
  admins may not request leave, they decide on it. Viewers see only their own.
- **At request time.** At most 366 days, not starting in the past, no overlap with
  the employee's own pending or approved leave, and **no touch of a blackout
  period** (400 with the reason). A **limit** is never a refusal: a request that
  would put more people with a capability out than allowed comes back with
  `warnings`, and the planner who decides sees the same.
- **Approval** writes, in one transaction, a hard whole-day unavailability per day
  and its roster mirror (`absence_type: unavailable`). A day that already has a
  whole-day unavailability is left as it is (and so is never removed by a revoke);
  a day already marked sick or another absence keeps its entry; a planned shift
  or a free day makes way. It follows the month's status like every roster write —
  **428** `reason_required` inside the freeze window of a published month, an
  admin with a reason for a locked one — and each changed day becomes a change
  notice for the employee.
- **Revoke** removes the absences the approval created from today on; days that
  have passed stay.
- **The optimizer.** Pending leave reaches it as `preferred_off` (a soft wish to be
  off, never a block); approved leave is a hard absence like any other.

Every step leaves an audit entry (`leave_request.create`, `.cancel`, `.reject`,
`.approve`, `.revoke`; `leave_blackout.create`/`.delete`; `leave_limits.update`).

## Open shifts

A slot nobody is planned on, offered to the people who may take it. Qualified
employees volunteer; a planner assigns one, which writes the roster.

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/open-shifts` | List (`open` from today on; `status`, `from`) / offer a slot (**planner/admin**) |
| `GET` | `/open-shifts/count` | How many offers are open from today on |
| `GET` | `/open-shifts/gaps?from&to` | Slots below their ward's minimum with no offer yet (**planner/admin**, ≤ 92 days) |
| `POST` | `/open-shifts/{id}/volunteer`, `/withdraw` | The caller volunteers / takes it back |
| `POST` | `/open-shifts/{id}/assign` | `{"employee_id": …}` — writes the shift into the roster (**planner/admin**) |
| `POST` | `/open-shifts/{id}/close` | Withdraw the offer (**planner/admin**) |

- **Who may take a slot** is one rule set: not already working or absent that
  day, no hard unavailability, the shift among their available shifts, the
  ward's required capabilities (or a higher level of the same skill group), and
  the planner setting `min_rest_hours` to the shifts on the days around it. An
  employee who fails any is refused with **every** reason; the list endpoint tells
  each employee whether *they* may (`eligible`, `reasons`) and a planner the same
  for each volunteer. A planner cannot assign someone who may not either. What the
  rules do not know — the labor-law profile, personal limits — the plan check
  reports once the shift is in the roster.
- **Assigning** writes the shift (replacing a free day) and marks the offer
  `filled` in one transaction; it follows the month's status like every roster
  write (**428** inside the freeze window of a published month without
  `X-Change-Reason`, an admin for a locked one) and leaves a change notice.
- One open offer per slot (409 for a second). A closed or filled slot can be
  offered again.

Audit entries: `open_shift.create`, `.volunteer`, `.withdraw`, `.assign`, `.close`.

## Notifications

E-mail, off unless the backend has an `smtp.host` (see
[Configuration](configuration.md#smtp)). Events write to an outbox and a worker
delivers them with retries — a mail problem never fails the action behind it.

| Method | Path | Purpose |
|---|---|---|
| `GET` `PUT` | `/notification-preferences` | The caller's own: `email_enabled` and `muted_events`; everything is on until changed |
| `GET` | `/notification-outbox` | Recent mails and how they went (**planner/admin**) |

| Event | Who is told |
|---|---|
| `roster_published` | everyone with a shift in the month |
| `shift_changed` | an employee whose published roster changed — one mail per sweep (every 30 s), not per day; never for changes older than a day |
| `swap_update` | the people in a swap, as it moves |
| `leave_update` | the requester, when their leave is approved, rejected or revoked |
| `open_shift_offered` | employees who may take a new open shift, and the one it is assigned to |

A message is tried five times, 2, 4, 8 and 16 minutes apart, then marked `failed`
with the last error. Mails name the shift, the date and the status — never a
protected-group reason behind a legal rule.

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
