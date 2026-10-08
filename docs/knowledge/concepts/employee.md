---
type: Domain Entity
title: Employee
description: A member of staff — contracted weekly hours (or the tenant default), the qualifications they hold, and the shift types they work at all.
resource: src/models/employee.rs
tags: [domain, staff, employees]
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
  - resource: docs/guide/people.md
    author: human:maxrg
    last_modified: 2026-07-31
---

A person who can be rostered. Table `employees`.

# Schema

| Column | Meaning |
|---|---|
| `id` | UUID |
| `name` | Name as it appears on the roster |
| `email` | Work address; also how the system recognises them if they sign in |
| `weekly_working_hours` | Contracted hours per week; `NULL` follows the tenant default, `0` = no target |
| `tenant_id` | Isolation boundary |

Contracted hours are **per week**, and optional. An employee without their own
value follows the tenant's `default_weekly_working_hours` (planner settings,
**40 h** unless changed); changing the default re-targets everyone who follows
it. API responses carry both the own value and
`effective_weekly_working_hours`, the one that applies.

The effective hours are a **target, not a ceiling**. For any period they are
prorated as weekly hours × days ÷ 7 (a two-week plan at 40 h: 80 h; a 31-day
month at 35 h: 155 h) — by the solver, the plan check, the replacement ranking
and Fairness alike. Deviation is penalised symmetrically by
`monthly_hours_target_weight` (the name predates weekly hours) — overshooting is
as bad as undershooting. This is the mechanism by which part-time contracts are
respected: someone at 40 hours a week receives roughly twice the work of someone
at 20.

Until migration 33 the column was `monthly_working_hours`; it was converted as
monthly × 12 ÷ 52, rounded to 0.5 (160 → 37), and employees at 0 were moved to
the default.

# Link tables

Two link tables define what an employee may do. Both are hard eligibility
filters in the solver.

| Table | Primary key | Meaning |
|---|---|---|
| `employee_capabilities` | (`employee_id`, `capability_id`) | Qualifications held |
| `employee_available_shifts` | (`employee_id`, `shift_id`) | Shift types this person works at all |

**Capabilities** are conjunctive on the workstation side: a workstation requiring
*Intensive care* and *Ventilation* is open only to employees holding **both**.
See [Capability](/concepts/capability.md) and
[Workstation](/concepts/workstation.md).

**Available shifts** encode the contract, not a weekly preference. A day-only
contract simply has no night shift row. Someone merely *hoping* for early shifts
next week should keep all their shifts listed and record a
[shift wish](/concepts/shift-wish.md) instead.

# Related

* Absences and soft preferences: [Unavailability](/concepts/unavailability.md)
* Fixed commitments: [Shift assignment](/concepts/shift-assignment.md)
* Where they end up: [Confirmed shift plan](/concepts/confirmed-shift-plan.md)
* Endpoints: [REST API](/interfaces/rest-api.md)
* Managing them in the UI: [Staff management](/guide/staff-management.md)

# Diagnostics

An employee who comes back barely scheduled is almost always one of: no
capabilities recorded (eligible for nothing), very few available shifts, low
weekly hours (correct behaviour for a part-timer), or a forgotten stretch
of unavailability. See [User troubleshooting](/guide/troubleshooting-playbook.md).
