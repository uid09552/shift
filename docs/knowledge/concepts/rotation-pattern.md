---
type: Domain Entity
title: Rotation Pattern
description: A named repeating cycle of shifts and days off, applied to people with a stagger to write their fixed shift assignments — previewed with dry_run first; the optimizer keeps them ahead of every other goal.
resource: src/services/rotation_pattern.rs
tags: [domain, rotation, cycle, fixed-assignment, dry-run]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-30T00:00:00Z
sources:
  - resource: openspec/specs/rotation-patterns/spec.md
    author: human:maxrg
    last_modified: 2026-10-25
---

A **rotation pattern** is a named cycle — for example *early, early, late,
late, night, night, off, off, off* — that repeats. The **Rotations** page
keeps the ward's patterns.

# Applying a pattern

Applying a pattern to a group of people over a period writes their
[fixed shift assignments](/concepts/shift-assignment.md): one per person and
day, a shift or — for an *off* day in the cycle — a day off. A **stagger**
(`offset_step`) shifts each next person's start in the cycle, so the group
does not all work nights at once.

`POST /rotation-patterns/{id}/apply` (`applyRotationPattern`) takes the
`employee_ids`, `start_date`, `end_date`, `offset_step` and
`replace_existing`. With **`dry_run: true`** it returns what it would write and
writes nothing — always look at that preview first; the assistant does.

# What the optimizer does with them

The solver keeps fixed assignments **ahead of every other goal** — coverage,
balance, wishes. They are not hard rules, though: one that a rule forbids (a
rest period, an absence, labor law) is dropped and named in the result's
`message` instead of making the plan infeasible.

The planner setting *Keep rotations* (`keep_fixed_assignments`, on by default)
switches this off: the solver then plans as if there were none, without
touching the assignments themselves. The plan check follows the same setting.
