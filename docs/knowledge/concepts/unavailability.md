---
type: Domain Entity
title: Unavailability
description: A day or single shift an employee cannot work — either a hard block the solver never overrides, or a soft preference it pays to override.
resource: src/models/unavailability.rs
tags: [domain, absence, availability]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/domain-model.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: docs/guide/people.md
    author: human:maxrg
    last_modified: 2026-07-31
---

An employee cannot work on a date. Table `unavailabilities`.

# Schema

| Column | Meaning |
|---|---|
| `employee_id` | Who |
| `unavailable_date` | Which day |
| `shift_id` | Optional — set, it blocks only that shift; `NULL`, the whole day |
| `is_soft_preference` | How firmly (see below) |
| `tenant_id` | Isolation boundary |

The UI presents three absence kinds — *Unavailable*, *Vacation*, *Sick Leave* —
which differ in how they are coloured across the calendars, not in how the solver
treats them.

# Hard block vs. soft preference

This one boolean separates *"I am on holiday"* from *"I would rather not"*.

| `is_soft_preference` | Behaviour |
|---|---|
| `false` (default) | **Hard constraint.** The solver will not assign this employee, whatever the consequences. |
| `true` | **Penalised preference.** The solver avoids it, and overrides it only when the alternative is leaving a post unstaffed, paying `preference_weight` (default 300). |

Getting this wrong degrades the roster in both directions. Marking every
preference as a hard absence gradually makes the ward impossible to staff;
marking a real holiday as soft means somebody may be rostered while abroad.

Soft entries reach the optimizer as `preferred_off` on the employee in the
[optimizer contract](/interfaces/optimizer-contract.md).

# Workstation closures are a separate table

`workstation_unavailabilities` (`workstation_id`, `unavailable_from`,
`unavailable_to`) closes a place rather than a person. See
[Workstation](/concepts/workstation.md).

# Related

* Whose absence: [Employee](/concepts/employee.md)
* The positive counterpart: [Shift wish](/concepts/shift-wish.md)
* The weight: [Planner settings reference](/solver/planner-settings-reference.md)
* Recording them: [Staff management](/guide/staff-management.md)
