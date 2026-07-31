---
type: Domain Entity
title: Employee
description: A member of staff — contracted monthly hours, the qualifications they hold, and the shift types they work at all.
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
| `monthly_working_hours` | Contracted monthly target |
| `tenant_id` | Isolation boundary |

`monthly_working_hours` is a **target, not a ceiling**. Deviation is penalised
symmetrically by `monthly_hours_target_weight` — overshooting is as bad as
undershooting. This is the mechanism by which part-time contracts are respected:
someone at 160 hours receives roughly twice the work of someone at 80.

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
capabilities recorded (eligible for nothing), very few available shifts, a low
monthly hours figure (correct behaviour for a part-timer), or a forgotten stretch
of unavailability. See [User troubleshooting](/guide/troubleshooting-playbook.md).
