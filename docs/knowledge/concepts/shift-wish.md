---
type: Domain Entity
title: Shift Wish
description: An employee's request to work a particular shift on a particular date — a soft reward for the solver, never a commitment.
resource: migrations/00000000000023_add_shift_wishes/up.sql
tags: [domain, preferences, planning]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: migrations/00000000000023_add_shift_wishes/up.sql
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: planner/shift_planner/models.py
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: docs/guide/people.md
    author: human:maxrg
    last_modified: 2026-07-31
---

The positive counterpart to a soft [unavailability](/concepts/unavailability.md):
*"I would like the early shift on the 14th."* Table `shift_wishes`, added in
migration 23.

# Schema

| Column | Meaning |
|---|---|
| `id` | UUID |
| `employee_id` | Who is asking; `ON DELETE CASCADE` |
| `shift_id` | Which shift; `ON DELETE CASCADE` |
| `wish_date` | Which day |
| `tenant_id` | Isolation boundary |
| `created_at` | When recorded |

`UNIQUE (employee_id, wish_date)` — one wish per person per day. Recording a new
wish for a day replaces the intent for that day rather than accumulating.

# How the solver treats it

A wish is a **soft reward**, worth `wish_weight` when granted. It never forces an
assignment and never blocks one. `wish_weight: 0` disables wish handling
entirely.

The default of **20000** is deliberately calibrated against the other weights: it
is twice the `high` coverage weight, so granting a wish outweighs the ordinary
value of filling a slot, while staying below the understaffing penalty and below
`equality_weight` (50000). Raising it towards `equality_weight` makes wishes
near-mandatory at the cost of fairness. The setting was added in migration 24 —
before it, the backend had no stored value to send and the optimizer's built-in
default was drowned out by the much larger fairness and coverage terms.

# Related

* Endpoints: `GET`/`POST /shift-wishes`, `GET`/`DELETE /shift-wishes/{wishId}` — see [REST API](/interfaces/rest-api.md)
* The binding version: [Shift assignment](/concepts/shift-assignment.md)
* The weight: [Planner settings reference](/solver/planner-settings-reference.md)
* Entering them: [Staff management](/guide/staff-management.md)

# Note on coverage elsewhere

`wish_weight` is present in `planner_settings`, in the optimizer's
`ConstraintConfig`, and in `CLAUDE.md`. It is **not** yet listed in the settings
table in `docs/planner.md` or in the user guide's Planner Settings page — treat
this concept and the schema as authoritative until that gap is closed.
