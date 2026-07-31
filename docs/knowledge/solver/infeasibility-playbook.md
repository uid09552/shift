---
type: Playbook
title: Infeasibility Playbook
description: What `infeasible` means, the five causes it is nearly always one of, and the bisection procedure for finding which.
tags: [solver, troubleshooting, playbook, infeasible]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/planner.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: docs/guide/troubleshooting.md
    author: human:maxrg
    last_modified: 2026-07-31
---

`infeasible` means the [hard constraints](/solver/constraint-model.md) cannot all
be satisfied at once. No roster exists. This is an **answer, not a crash**.

**It never means "short-staffed."** Minimum staffing is a soft objective, so a
ward with too few people returns a thin roster, not an infeasible one. That
excludes headcount from the search immediately and leaves nine hard constraints
to check.

# Start here

```bash
curl -X POST http://localhost:8081/api/v1/planner/prepare \
  -H 'Content-Type: application/json' \
  -d '{"start_date":"2026-08-01","end_date":"2026-08-31"}' > payload.json
```

`POST /planner/prepare` returns the exact payload that would be published,
without solving. Everything below is easier to check in that file than in the
database or the UI, and it can be re-solved offline as many times as you like —
see [Optimizer contract](/interfaces/optimizer-contract.md).

# The five causes, in order of likelihood

1. **A workstation requires a combination of capabilities nobody holds.**
   Required capabilities are conjunctive — *all* of them, not *any*. Four
   requirements is often nobody. Cross-check `required_skills` on each workstation
   against the `skills` arrays in `employees`.
2. **A shift has no weekday times for a day it is expected to run.** A weekday
   absent from `weekday_times` is a weekday the shift does not exist — but a
   workstation may still list it in `operating_shifts` and demand it. See
   [Shift](/concepts/shift.md).
3. **Rest and recovery limits are too tight for the headcount.**
   `max_working_days_per_week`, `max_consecutive_days` and
   `night_shift_recovery_days` multiply. Four people cannot cover a 24/7 post at
   five days a week each.
4. **`min_rest_hours` makes a required sequence impossible.** At 11 hours, a late
   shift ending 22:00 rules out an early starting 06:00 next morning. If the only
   night-capable person must also do the following early, there is no legal answer.
5. **Absences have removed the only qualified person from a mandatory post.**

# The procedure

Relax **one** thing, recalculate, observe. Never two.

| Step | Change | If it now solves |
|---|---|---|
| 1 | `max_working_days_per_week: 0` | Cause 3 — the day caps were the problem |
| 2 | `max_consecutive_days: 0` | Cause 3 |
| 3 | `min_rest_hours: 0` | Cause 4 |
| 4 | `night_shift_recovery_days: 0` | Cause 3, via recovery |
| 5 | Remove one required capability from the suspect workstation | Cause 1 — now you know where to look |
| 6 | Widen the date range by a few days | Often cause 4 or 5 at a boundary |

Editing `constraints` in the captured `payload.json` and re-solving with
`uv run shift-planner schedule payload.json out.json` runs each step in seconds
without touching the tenant's stored settings.

# What not to do

**Do not relax everything at once to "get a plan out".** A roster produced with
`min_rest_hours: 0` and no day cap is legal to the solver and illegal to the
labour agreement, and nothing in the system will flag it later. Find the cause,
fix the data, restore the limits.

**Do not raise `solver_time_limit_seconds`.** Infeasibility is proven, not timed
out. More time will not help. The time limit only matters for the difference
between `feasible` and `optimal`.

# Related

* [Constraint model](/solver/constraint-model.md) - the nine constraints being violated
* [Soft minimum, hard maximum](/architecture/soft-minimum-hard-maximum.md) - why headcount is not on the list
* [User troubleshooting](/guide/troubleshooting-playbook.md) - the non-technical version
