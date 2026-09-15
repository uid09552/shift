---
type: Constraint Model
title: Objective Terms
description: The nine scored goals the solver maximises as a weighted sum, why their weights differ by orders of magnitude, and which two are deliberately non-obvious.
resource: planner/shift_planner/optimizer.py
tags: [solver, objective, weights, trade-offs]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: planner/shift_planner/optimizer.py
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: docs/planner.md
    author: human:maxrg
    last_modified: 2026-07-25
---

The solver works in two phases.

1. **Fixed assignments, then coverage.** It minimises broken fixed
   assignments (`fixed_shifts` — rotations write them), each weighted above the
   largest possible total shortfall, and then the shortfall against every
   `min_employees` — per workstation slot, weighted by that workstation's
   `priority_weights` entry, and per shift, weighted as `high`. Nothing else is
   in play, so no other goal can buy a slot empty or move a fixed day. Fixed
   assignments are not hard constraints: one a rule forbids is left out and
   named in `message` instead of making the plan infeasible.
2. **Everything else.** It pins the shortfall at what phase 1 reached and
   maximises the weighted sum below, starting from phase 1's roster. Every term
   in the table is traded off against every other — but none of them against
   coverage.

Phase 1 may use up to half of `solver_time_limit_seconds`; it usually needs a
second or two. In `hard` [minimum-staffing mode](/architecture/soft-minimum-hard-maximum.md)
there is no shortfall to minimise; unless there are fixed assignments to keep,
only phase 2 runs.

Slots the roster still leaves short are listed in the result's `message`, with
a reason: *not enough staff left*, or *nobody qualified and available* — the
latter is a slot no one in the input can take at all (a capability no employee
holds, a shift nobody has among their available shifts), which is a setup
problem, not a solver one.

| Term | Effect | Governing setting |
|---|---|---|
| Staffing shortfall | Settled in phase 1; kept in phase 2 only in case phase 1 ran out of time | — (weighted by priority) |
| Coverage | Rewards assignments, weighted by workstation priority | `priority_weights` |
| Equal treatment | Minimises the spread of working hours across employees | `equality_weight` |
| Monthly hours target | Symmetric penalty on deviation from contracted hours | `monthly_hours_target_weight` |
| Weekly hour band | Soft floor/ceiling over rolling 7-day blocks | `weekly_min_hours`, `weekly_max_hours`, `weekly_hours_target_weight` |
| Preferences | Penalises overriding a soft `preferred_off` entry | `preference_weight` |
| Wishes | Rewards granting a [shift wish](/concepts/shift-wish.md) | `wish_weight` |
| Skill downgrade | Penalises staffing a post with an over-qualified person, by level gap within a `skill_group` | `skill_downgrade_weight` |
| Fatigue | Ergonomic cost per shift, amplified for nights | `fatigue_weight`, `night_shift_fatigue_multiplier` |
| Shift continuity | Rewards the same shift on consecutive days, bonus for a whole week | `shift_continuity_weight`, `shift_continuity_week_bonus` |

# Two terms that are not what you would guess

**Fatigue is minimax, not mean.** It minimises the *worst-off* employee's fatigue
rather than the team average. An average-based cost is perfectly content to wreck
one person's month as long as the mean looks fine; this one is not.

**Monthly hours deviation is symmetric.** Overshooting a contracted target is
penalised exactly as much as undershooting it. That is what makes part-time
contracts work: a 160-hour employee receives roughly twice the work of an 80-hour
one, rather than everyone being loaded to a ceiling.

# Why the weights differ by orders of magnitude

`equality_weight` at 50000 against `fatigue_weight` at 100 is not sloppiness. The
wide gaps make the goals effectively rank-ordered inside a single objective:
fairness beats fatigue almost every time. In the coverage phase, a `high`-priority
post beats a `low` one by a hundredfold.

Coverage used to sit in the same sum, and that is exactly why it no longer does.
Hours-based terms are priced per tenth of an hour, so a long shift — a 24-hour
on-call, or any shift the one part-timer cannot share — cost more in fairness and
fatigue than filling it earned, and the solver left it empty.

The consequence for tuning: **changing a weight by a factor of ten does not adjust
it slightly — it can change which goal wins outright.** Change one value,
recalculate, compare, then move on. Changing four at once makes the result
uninterpretable.

The same logic sets `wish_weight` at 20000: twice the `high` coverage weight, so a
granted wish outweighs the ordinary value of filling a slot, but below the
understaffing penalty and below `equality_weight`.

# Which term to reach for

| Symptom | Term to adjust |
|---|---|
| Roster feels lopsided | Raise `equality_weight` |
| Posts left short | Read the result's `message`: *nobody qualified and available* is a setup gap; *not enough staff left* means the pool is too small for the rules |
| Critical posts lose out to minor ones | Widen the gaps in `priority_weights` |
| People rotated between shifts daily | Raise `shift_continuity_weight`, `shift_continuity_week_bonus` |
| Everyone under contracted hours | Check `monthly_hours_target_weight` is non-zero, and that **Match monthly hours** was ticked |
| Wishes rarely granted | Raise `wish_weight` towards `equality_weight` |
| Senior staff burned on junior work | Raise `skill_downgrade_weight` — requires `skill_group` and `level` to be set |
| Roster looks generally unpolished | Raise `solver_time_limit_seconds` first — often it is just the timer |

# Related

* [Constraint model](/solver/constraint-model.md) - what is enforced rather than scored
* [Planner settings reference](/solver/planner-settings-reference.md) - defaults and ranges
* [Soft minimum, hard maximum](/architecture/soft-minimum-hard-maximum.md)
