---
type: Domain Entity
title: Shift
description: A named work period whose times, staffing band and mandatory rest days are defined per weekday.
resource: src/models/shift.rs
tags: [domain, shifts, scheduling]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/domain-model.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: src/schema.rs
    author: human:maxrg
    last_modified: 2026-07-31
---

A named work period — *Early*, *Late*, *Night*, *On call*. Table `shifts` carries
only identity and presentation; everything operational lives per weekday in
`shift_weekday_times`.

# Schema

`shifts`:

| Column | Meaning |
|---|---|
| `name` | Full name as staff know it |
| `short_name` | Compact calendar label, max 10 characters |
| `color` | Hex colour used across every calendar |
| `order` | Display order; lower first |

`shift_weekday_times`:

| Column | Meaning |
|---|---|
| `shift_id` | Owning shift |
| `weekday` | 0–6 |
| `start_time`, `end_time` | Times **for that weekday**; `end < start` means the shift crosses midnight |
| `min_employees` | Soft staffing target for that weekday |
| `max_employees` | Hard staffing ceiling for that weekday |
| `free_days_after_shift` | Mandatory rest days following this shift |

# A weekday with no row is a weekday the shift does not run

This is the entire mechanism for modelling reduced service. A Saturday-only
skeleton crew is a Saturday row with a lower `min_employees` and
`max_employees`; a service that does not operate on Sundays simply has no Sunday
row.

It is also a common cause of infeasibility: a workstation may still list the
shift among its `active_shift_ids` and demand it on a day for which the shift has
no times. See [Infeasibility playbook](/solver/infeasibility-playbook.md).

# min is soft, max is hard

`max_employees` is a hard constraint the solver will never violate.
`min_employees` is a penalised objective term, not a rule. The asymmetry is
deliberate and explained in
[Soft minimum, hard maximum](/architecture/soft-minimum-hard-maximum.md).

# free_days_after_shift

Generalises the night-shift recovery rule to any shift type. Set `2` on a night
shift for the conventional rule. Enforced as a hard constraint. The
`night_shift_recovery_days` setting covers the same ground globally — see
[Planner settings reference](/solver/planner-settings-reference.md).

# Related

* Who may work it: `employee_available_shifts` on [Employee](/concepts/employee.md)
* Where it runs: `active_shift_ids` on [Workstation](/concepts/workstation.md)
* Requests for it: [Shift wish](/concepts/shift-wish.md)
* Endpoints: [REST API](/interfaces/rest-api.md)
