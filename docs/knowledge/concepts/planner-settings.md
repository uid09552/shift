---
type: Domain Entity
title: Planner Settings
description: One row per tenant holding every tunable weight and limit for the solver, sent with each optimization task.
resource: src/services/planner_settings.rs
tags: [domain, configuration, optimizer]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: migrations/00000000000021_add_planner_settings
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: planner/shift_planner/models.py
    author: human:maxrg
    last_modified: 2026-07-31
---

Table `planner_settings`, added in migration 21. **Primary key `tenant_id`** —
exactly one row per tenant, no surrogate id.

It mirrors the optimizer's `ConstraintConfig` and is serialised into the
`constraints` block of every task the backend publishes. Editing it changes every
subsequent calculation for that tenant.

# Where solver configuration is *not*

Solver weights are deliberately **not** in `config.yaml`. Backend configuration
(ports, database URL, broker host) is per-deployment and static; solver weights
are per-tenant and edited by ward managers at runtime through the UI. Mixing the
two would mean a restart to retune a roster. See
[Backend configuration](/operations/backend-configuration.md) for what *does*
live in the config file.

# Editing it

| Method | Path |
|---|---|
| `GET` | `/api/v1/planner-settings` |
| `PUT` | `/api/v1/planner-settings` |

Or via **Configuration → Planner Settings** in the UI.

One value can be overridden for a single run without changing stored settings:
`monthly_hours_target_weight` may be passed in the `POST /planner/plan` body.
This is what the optimizer page's **Match monthly hours** checkbox sets.

# The full list

Every setting, its default and its effect is documented in
[Planner settings reference](/solver/planner-settings-reference.md). The
non-obvious property is that the weights sit on wildly different scales on
purpose — 50000 for fairness against 100 for fatigue encodes a near-lexicographic
priority order inside a single objective, so changing one by an order of
magnitude changes *which term wins*, not just how much it matters.

# Related

* What each weight does: [Objective terms](/solver/objective-terms.md)
* The hard limits: [Constraint model](/solver/constraint-model.md)
* The settings page: [Creating a schedule](/guide/creating-a-schedule.md)
