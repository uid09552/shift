---
type: Domain Entity
title: Shift Swap Request
description: An employee's request to trade one of their confirmed shifts for a colleague's — agreed by the colleague, decided by a planner, with rule breaches shown as warnings only.
resource: migrations/00000000000032_add_shift_swap_requests/up.sql
tags: [domain, roster, self-service, approval]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-08T00:00:00Z
sources:
  - resource: migrations/00000000000032_add_shift_swap_requests/up.sql
    author: human:maxrg
    last_modified: 2026-10-08
  - resource: src/services/shift_swap.rs
    author: human:maxrg
    last_modified: 2026-10-08
  - resource: docs/api.md
    author: human:maxrg
    last_modified: 2026-10-08
---

*"Can I have your late on Tuesday for my early on Monday?"* — asked in the app
instead of at the planner's door. Table `shift_swap_requests`, added in
migration 32. It changes the [confirmed roster](/concepts/confirmed-shift-plan.md)
only; the solver never sees a request.

# Flow

1. A `shift-viewer` offers one of **their own** confirmed shifts (today or later)
   for one of a colleague's. Planners and admins cannot request: every swap needs
   the colleague's consent. → `pending_colleague`
2. The colleague accepts (→ `pending_planner`) or declines (→ `rejected`).
3. A `shift-planner` or `shift-admin` approves (→ `approved`, the two roster rows
   are exchanged) or rejects (→ `rejected`).

While pending, the requester may cancel (→ `cancelled`); once the earlier date
has passed it is `expired`. If either shift was edited or removed between request
and approval, approval refuses and marks it `stale`.

# Schema

| Column | Meaning |
|---|---|
| `requester_id`, `colleague_id` | The two employees; `ON DELETE CASCADE` |
| `requester_date`, `requester_shift_id`, `requester_workstation_id` | The offered shift, by value |
| `colleague_date`, `colleague_shift_id`, `colleague_workstation_id` | The shift asked for in return, by value |
| `status` | One of the states above |
| `decided_by` | Who took the last decision |

The shifts are stored **by value, not by row id**, so approval can compare them
with the roster as it is then.

# What is checked, and when

- **At request**: both shifts exist in the confirmed roster; on different days,
  each person is free on the other's day (one roster row per person and day).
  Qualification and every other rule are deliberately **not** checked.
- **At review**: the agent's swap check lists, for each person, every rule the
  new shift breaks — qualification, rest, recovery days, streaks, weekly cap,
  station maximum, personal limits. **Warnings only**: a planner may approve a
  swap that breaks a rule; the warnings are kept in the audit entry.

# Where it shows

On the Schedule page: *Request a swap…* in an employee's own cell, the **Swap
requests** panel for answering and deciding, and — for planners and admins only —
a count on the header bell.
