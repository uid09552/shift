---
type: Reference
title: Planner Settings Reference
description: Every solver setting with its default, valid range and effect — the ConstraintConfig contract shared by the optimizer and the backend's planner_settings table.
resource: planner/shift_planner/models.py
tags: [solver, reference, settings, configuration]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: planner/shift_planner/models.py
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: migrations/00000000000024_add_wish_weight/up.sql
    author: human:maxrg
    last_modified: 2026-07-31
---

`ConstraintConfig` in `planner/shift_planner/models.py` defines the defaults; the
backend mirrors them per tenant in `planner_settings` and sends them with every
task. All fields are optional — an omitted field falls back to the default below.
Edit via `PUT /api/v1/planner-settings` or **Configuration → Planner Settings**.

# Hard limits

Set any of these to `0` to disable that constraint entirely.

| Setting | Default | Range | Effect |
|---|---|---|---|
| `night_shift_recovery_days` | `2` | 0–7 | Days off compulsory after a night shift |
| `min_rest_hours` | `11.0` | 0–24 | Rest required between shifts on consecutive days; prevents late→early |
| `max_consecutive_days` | `6` | 0–14 | Longest run of working days |
| `max_working_days_per_week` | `5` | 0–7 | Working days per calendar week |

These four multiply together. Tightening all of them at once on a thin ward is the
commonest route to [infeasible](/solver/infeasibility-playbook.md).

# Objective weights

| Setting | Default | Effect |
|---|---|---|
| `equality_weight` | `50000` | Weight on even workload distribution. The loudest term by design |
| `priority_weights` | `{high: 10000, medium: 1000, low: 100}` | Coverage reward per workstation priority. The **gaps** carry the meaning, not the magnitudes |
| `monthly_hours_target_weight` | `1000` | Weight on hitting contracted monthly hours; deviation penalised symmetrically |
| `shift_continuity_weight` | `500` | Reward for the same shift on consecutive days |
| `shift_continuity_week_bonus` | `2000` | Extra reward for a consistent full week |
| `wish_weight` | `20000` | Reward for granting a [shift wish](/concepts/shift-wish.md); `0` disables wish handling |
| `preference_weight` | `300` | Cost of overriding a soft `preferred_off` day. Never blocks an assignment |
| `skill_downgrade_weight` | `200` | Cost per level of over-qualification. No effect unless `skill_group` is set |
| `fatigue_weight` | `100` | Weight on the ergonomic term; `0` switches fatigue tracking off |
| `night_shift_fatigue_multiplier` | `2.0` | How much more tiring a night shift is |

# Weekly hours band

Optional soft band over rolling 7-day windows, separate from the monthly target
and from the hard day-count cap. Useful when the monthly target alone permits 70
hours one week and 10 the next.

| Setting | Default | Effect |
|---|---|---|
| `weekly_min_hours` | `None` | Soft floor; `None`/`0` disables |
| `weekly_max_hours` | `None` | Soft ceiling; `None`/`0` disables |
| `weekly_hours_target_weight` | `1000` | How hard to stay inside the band |

# Solver performance

| Setting | Default | Effect |
|---|---|---|
| `solver_time_limit_seconds` | `120.0` | Wall-clock search budget |
| `solver_num_workers` | `8` | Parallel search workers |

**`solver_time_limit_seconds` is the honest quality knob.** CP-SAT returns the best
solution found within the budget, so a `feasible` result on a large ward usually
just means the timer expired. If a roster looks unpolished, raising this to 300
and recalculating is the first thing to try — it costs nothing but waiting.

# Per-run override

`monthly_hours_target_weight` can be passed in the `POST /planner/plan` body to
override it for a single run without changing stored settings. This is what the
optimizer page's **Match monthly hours** checkbox does. No other setting has a
per-run override.

# Coverage gap

`wish_weight` is present in `planner_settings`, in `ConstraintConfig` and in
`CLAUDE.md`, but is **not** listed in the settings table in `docs/planner.md` nor
on the user guide's Planner Settings page. This reference and the schema are
authoritative.

# Related

* [Objective terms](/solver/objective-terms.md) - what each weight buys
* [Constraint model](/solver/constraint-model.md) - the hard rules
* [Planner settings](/concepts/planner-settings.md) - the entity and its endpoints
