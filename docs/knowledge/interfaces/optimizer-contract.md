---
type: Data Contract
title: Optimizer Contract
description: The JSON the backend sends the CP-SAT solver and the JSON that comes back — sections, fields, and how to capture a real payload.
resource: planner/shift_planner/models.py
tags: [interfaces, contract, optimizer, json]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: planner/shift_planner/models.py
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: docs/planner.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: planner/input.json
    author: human:maxrg
    last_modified: 2026-07-31
---

Defined by Pydantic models in `planner/shift_planner/models.py`. `planner/input.json`
is a worked example. The backend builds this payload from the database.

**To see the real thing, call `POST /api/v1/planner/prepare`** — it returns exactly
what would be published, without solving. That is the starting point for any
question of the form "why did the solver decide that".

# Input — `SchedulingInput`

| Section | Contents |
|---|---|
| `planning_period` | `start_date`, `end_date` |
| `shifts` | `id`, `name`, `is_night_shift`, `weekday_times[]` |
| `workstations` | `id`, `name`, `required_skills`, `priority`, `operating_shifts`, `min_employees`, `max_employees`, `unavailability[]` |
| `employees` | `id`, `name`, `skills`, `available_shifts`, `unavailability[]`, `monthly_working_hours`, `preferred_off[]`, `wishes[]` |
| `capabilities` | `id`, `level`, `skill_group` — for the skill-downgrade objective |
| `constraints` | The `ConstraintConfig` block |

Each `weekday_times` entry carries `weekday`, `start_time`, `end_time`,
`min_employees`, `max_employees` and `free_days_after_shift`. **A weekday absent
from the list is a weekday the shift does not run** — see
[Shift](/concepts/shift.md).

Two employee fields correspond to the soft/hard split on absences:
`unavailability[]` holds hard blocks, `preferred_off[]` holds soft preferences.
`wishes[]` carries [shift wishes](/concepts/shift-wish.md).

`constraints` mirrors the tenant's [planner settings](/concepts/planner-settings.md);
every field is optional and falls back to the Pydantic default. Full list in
[Planner settings reference](/solver/planner-settings-reference.md).

# Output

| Field | Meaning |
|---|---|
| `status` | `optimal`, `feasible`, or `infeasible` |
| `objective_value` | Solver score — comparable only between runs of the same model |
| `schedule` | Per-day → per-shift → assignments (employee → workstation) |
| `employee_plans` | Per-employee daily plan, including `free` days |
| `message` | Diagnostics, notably on infeasibility |

The backend stores this verbatim as JSONB — see
[Optimized shift result](/concepts/optimized-shift-result.md).

# Replaying a payload offline

Because the optimizer is stateless, a captured payload solves identically in any
of its three modes:

```bash
curl -X POST http://localhost:8081/api/v1/planner/prepare \
  -H 'Content-Type: application/json' \
  -d '{"start_date":"2026-08-01","end_date":"2026-08-31"}' > payload.json

cd planner
uv run shift-planner schedule payload.json result.json     # no infrastructure
# or
curl -X POST http://localhost:8888/api/v1/optimize \
  -H 'Content-Type: application/json' -d @payload.json     # make api
```

This is the fastest way to test a settings change: edit `constraints` in the
captured file, re-solve, compare. No database write, no tenant affected.

# Related

* [Optimizer service](/architecture/optimizer-service.md)
* [Constraint model](/solver/constraint-model.md), [Objective terms](/solver/objective-terms.md)
* [NATS subjects](/interfaces/nats-subjects.md) - how it actually travels
