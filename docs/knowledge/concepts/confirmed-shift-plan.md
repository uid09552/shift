---
type: Domain Entity
title: Confirmed Shift Plan
description: The approved roster — one row per employee per day, backing every calendar and every analysis endpoint.
resource: src/models/confirmed_shift_plan.rs
tags: [domain, roster, output]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/domain-model.md
    author: human:maxrg
    last_modified: 2026-07-25
---

The official schedule. Table `confirmed_shift_plans`, one row per employee per
day. This is the only plan the rest of the system reads — calendars, the
dashboard and the `/analysis/*` endpoints all query it.

# Schema

| Column | Meaning |
|---|---|
| `employee_id` | Who |
| `date` | Which day |
| `shift_id` | Which shift; **nullable** |
| `workstation_id` | Where; **nullable** |
| `is_present` | Whether the person is working that day |
| `absence_type` | Why not, when `is_present` is false |
| `creation_type` | How the row came to be — optimizer output vs. manual edit |
| `tenant_id` | Isolation boundary |

`shift_id` and `workstation_id` are nullable so a row can record an absence
rather than an assignment (migration 13). `workstation_id` was added in migration
8 — plans record *where*, not just *when*.

# How rows get here

Two paths, and they interact:

1. **`POST /planner/optimized-shifts/{id}/take-as-plan`** copies a chosen
   [optimized shift result](/concepts/optimized-shift-result.md) into this table.
   Nothing the solver produces reaches the roster any other way.
2. **Direct edits** through the Schedule and Employee Calendar views, or through
   `PUT /confirmed-shift-plans/{id}`.

Taking a result as the plan **overwrites the confirmed roster for the whole
period it covers**, including hand edits made in that window. That is the single
most common cause of "my changes disappeared" — see
[User troubleshooting](/guide/troubleshooting-playbook.md). The optimizer UI
offers a per-employee variant so a recalculated roster can be adopted for the two
departments that changed without disturbing the rest of the ward.

# Related

* Where the numbers come from: [Optimized shift result](/concepts/optimized-shift-result.md)
* The full sequence: [Planning pipeline](/architecture/planning-pipeline.md)
* Reading it: [Reading calendars](/guide/reading-calendars.md)
* Endpoints: [REST API](/interfaces/rest-api.md)
