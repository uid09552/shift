---
type: Domain Entity
title: Shift Assignment
description: A fixed pre-arranged commitment of an employee to a shift on a date, which the optimizer must respect and plan around.
resource: src/models/employee_shift_assignment.rs
tags: [domain, planning, commitments]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/domain-model.md
    author: human:maxrg
    last_modified: 2026-07-25
---

Table `employee_shift_assignments` fixes a person to a shift on a date **before**
solving. Columns: `employee_id`, `shift_id`, `date`, `tenant_id`.

These are commitments already made — a training day, a handover, a rota agreed
outside the system. The optimizer takes them as given and builds the rest of the
roster around them, which means they also consume that person's rest windows,
weekly day count and consecutive-day budget.

# Distinguishing the three "this person, this shift, this day" records

Three tables express superficially similar facts. They are not interchangeable:

| Table | Force | Meaning |
|---|---|---|
| `employee_shift_assignments` | Binding input | A decision already made; the solver plans around it |
| `shift_wishes` | Rewarded input | A request; the solver is paid to grant it, and may decline — see [Shift wish](/concepts/shift-wish.md) |
| `confirmed_shift_plans` | Output | What was actually rostered — see [Confirmed shift plan](/concepts/confirmed-shift-plan.md) |

In the UI both an assignment and a wish are created from the Employee Calendar
day menu, under *Assign shift* and *Wish shift (optimizer)* respectively. Choosing
the wrong one is a common source of confusion: an assignment is a decision, a
wish is a request.

# Related

* Endpoints: `GET`/`POST /employees/{id}/shift-assignments`, `DELETE /shift-assignments/{id}` — see [REST API](/interfaces/rest-api.md)
* Whose commitment: [Employee](/concepts/employee.md)
