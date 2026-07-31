---
type: Domain Entity
title: Capability
description: A named qualification that links what a workstation needs to what a person can do, optionally ranked within a substitutable skill group.
resource: src/models/capability.rs
tags: [domain, skills, qualifications]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/domain-model.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: migrations/00000000000022_paper_algorithm_extensions
    author: human:maxrg
    last_modified: 2026-07-31
---

A qualification, skill or licence: *Intensive Care*, *Emergency Room*, *Surgery*,
*Wound care*. Table `capabilities`. It is the join between what a place requires
and what a person holds — the single most load-bearing piece of data in the
model.

# Schema

| Column | Default | Meaning |
|---|---|---|
| `id` | — | UUID |
| `name` | — | The qualification |
| `level` | `1` | Rank within a skill group; higher is more senior |
| `skill_group` | `NULL` | Groups substitutable tiers of the same skill |
| `tenant_id` | — | Isolation boundary |

`level` and `skill_group` were added in migration 22 to support the
skill-downgrade objective.

# Skill groups and the downgrade objective

When several capabilities share a `skill_group` and are ranked by `level`, the
solver may staff a post with a **higher-level** person than strictly required —
but pays `skill_downgrade_weight` per level of gap for doing so. The effect is
that senior staff are not silently burned on junior work while remaining
available as cover when nothing else fits.

Leaving `skill_group` unset — the default, and the state of every row predating
migration 22 — disables the behaviour entirely. Substitution then never happens:
a capability is either held or not.

# Design guidance

Only create a capability if it genuinely decides *who may work where*. Every
additional capability narrows the eligible pool multiplicatively, because a
workstation requires **all** of its listed capabilities rather than any of them.
Over-specified requirements are the most common cause of an
[infeasible](/solver/infeasibility-playbook.md) run and of chronically
understaffed workstations.

# Related

* Held by: [Employee](/concepts/employee.md)
* Required by: [Workstation](/concepts/workstation.md)
* The objective term: [Objective terms](/solver/objective-terms.md)
* The weight: [Planner settings reference](/solver/planner-settings-reference.md)
* Setting them up: [Ward setup](/guide/ward-setup.md)
