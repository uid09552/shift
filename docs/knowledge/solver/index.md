---
type: Directory
title: Solver
description: The CP-SAT model — hard constraints, scored objectives, every tunable setting, and how to diagnose a run that returns nothing.
tags: [solver, optimizer, cp-sat, constraints]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
---

The solver is not clever and it is not guessing. It enumerates rosters, discards
every one that breaks a hard constraint, scores the survivors, and returns the
best it found before its time budget expired.

So there are exactly two kinds of thing you can tell it — rules that eliminate
rosters, and goals that are traded off against each other. **Almost every
surprising result comes from the second kind**, because on a short-staffed ward
the goals always conflict and something has to be sacrificed.

* [Constraint model](/solver/constraint-model.md) - the nine hard constraints. Violating any makes a roster invalid.
* [Objective terms](/solver/objective-terms.md) - the nine scored goals and how they trade off.
* [Planner settings reference](/solver/planner-settings-reference.md) - every setting, default and effect.
* [Infeasibility playbook](/solver/infeasibility-playbook.md) - what `infeasible` means and how to find the cause.

# Reading a result

| Status | Meaning | Action |
|---|---|---|
| `optimal` | Proven best under the rules given | None |
| `feasible` | Valid, but the time limit expired before optimality was proven | Normal on any real ward. Raise `solver_time_limit_seconds` if the roster looks unpolished |
| `infeasible` | The hard constraints contradict each other | [Infeasibility playbook](/solver/infeasibility-playbook.md) |

`feasible` is **not a warning**. `objective_value` is comparable only between runs
of the same model over the same period with the same settings.

# The two facts that explain most behaviour

**Minimum staffing is soft; maximum staffing is hard.** A thin day is the solver
reporting a shortfall, not failing. See
[Soft minimum, hard maximum](/architecture/soft-minimum-hard-maximum.md).

**The weights are on wildly different scales on purpose.** 50000 for fairness
against 100 for fatigue encodes a near-lexicographic priority order inside a
single objective. Changing one weight by an order of magnitude changes *which term
wins*, not just how much it matters.

# Provenance

The skill-downgrade, soft-preference, weekly-hour-band and fatigue terms implement
objectives from the nurse-scheduling literature (Khalili et al., 2020), added in
migration `00000000000022_paper_algorithm_extensions`. Defaults were chosen so
existing tenants see no behaviour change until they deliberately group and rank
capabilities or mark preferences soft.
