---
type: Constraint Model
title: Constraint Model
description: The nine hard constraints of the CP-SAT model — violating any makes a roster invalid and, if unsatisfiable together, produces `infeasible`.
resource: planner/shift_planner/optimizer.py
tags: [solver, constraints, cp-sat, hard-rules]
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

Violating any of these makes a candidate roster invalid. If they cannot all be
satisfied simultaneously the solver returns `infeasible` and produces nothing.

# The nine

1. **One workstation per employee, day and shift.** Nobody is in two places at
   once.
2. **Maximum employees per (day, shift, workstation).** A post cannot be
   overstaffed.
3. **One shift per employee per day.** No double shifts.
4. **Maximum employees per (day, shift)** across all workstations.
5. **Forced recovery days after a shift** — `free_days_after_shift`, generalised
   from the night-shift rule to any shift type.
6. **Maximum working days per week** — `max_working_days_per_week`; `0` disables.
7. **Minimum rest between shifts on consecutive days** — `min_rest_hours`; `0`
   disables. This is what rules out a late shift followed by an early one.
8. **Maximum consecutive working days** — `max_consecutive_days`; `0` disables.
9. **Skills and availability.** An employee is eligible only for a workstation
   whose required skills they hold, in a shift they are available for, on a day
   they are not hard-unavailable, at a workstation that is open.

Constraints 6, 7 and 8 are configurable and can be switched off with `0`.
Constraints 1–5 and 9 come from the data and cannot be disabled.

# Where each one comes from

| Constraint | Source |
|---|---|
| 1, 3 | Built into the model |
| 2 | `max_employees` on [Workstation](/concepts/workstation.md) |
| 4 | `max_employees` on the weekday row of [Shift](/concepts/shift.md) |
| 5 | `free_days_after_shift` on the weekday row; `night_shift_recovery_days` globally |
| 6, 7, 8 | [Planner settings](/concepts/planner-settings.md) |
| 9 | [Capability](/concepts/capability.md) links, `employee_available_shifts`, [Unavailability](/concepts/unavailability.md), workstation `available` and closures |

# The asymmetry

**Maximum is hard; minimum is soft.** `min_employees` appears nowhere in this
list — it is a penalised objective term, not a rule. A short-staffed week
therefore returns the best achievable roster with the shortfall visible, rather
than the word `infeasible` and nothing else. The full reasoning is in
[Soft minimum, hard maximum](/architecture/soft-minimum-hard-maximum.md).

The practical consequence for diagnosis: **`infeasible` never means
"short-staffed"**. It means one of the nine above cannot hold. That is a much
smaller search space — see
[Infeasibility playbook](/solver/infeasibility-playbook.md).

# Constraints multiply

`max_working_days_per_week`, `max_consecutive_days` and `night_shift_recovery_days`
compose. Four people cannot cover a 24/7 post at five days a week each, however
the other settings are arranged. Tightening several at once on a thin ward is the
most common route to infeasibility.

# Related

* [Objective terms](/solver/objective-terms.md) - everything that is scored rather than enforced
* [Planner settings reference](/solver/planner-settings-reference.md)
* [Optimizer contract](/interfaces/optimizer-contract.md) - the payload these apply to
