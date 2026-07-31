---
type: Design Decision
title: Soft Minimum, Hard Maximum
description: Why the solver treats minimum staffing as a penalised goal and maximum staffing as an inviolable rule.
tags: [architecture, decision, solver, staffing]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/planner.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: docs/guide/how-planning-works.md
    author: human:maxrg
    last_modified: 2026-07-31
---

# Decision

`max_employees` — on both [shifts](/concepts/shift.md) and
[workstations](/concepts/workstation.md) — is a **hard constraint**. The solver
will never produce a roster that exceeds it.

`min_employees` is a **penalised objective term**. The solver is rewarded for
reaching it and pays a staffing-shortfall penalty for falling short, but a
shortfall never invalidates a solution.

# Rationale

If minimum staffing were a hard constraint, a week in which three people call in
sick would return `infeasible` and nothing else. The planner would learn only
that their rules cannot all be satisfied — not which post is short, not by how
much, not who might cover it. That is the least useful possible answer to the
most common possible situation.

As a penalty, the same week returns the best achievable roster with the shortfall
visible: a thin day in the workstation calendar, a number the planner can act on
by moving someone, relaxing a requirement or accepting the gap.

The reverse asymmetry holds for maxima. A ceiling usually encodes a *physical*
limit — beds, equipment, room, budget — that no amount of goodwill makes
negotiable. Modelling it as a penalty would let the solver buy its way past a
constraint that does not bend.

# Consequences

**A thin day is a report, not a bug.** A workstation showing fewer people than
requested is the solver stating that it could not do better under the rules given.
The response is to check the eligible pool, the priority, and who was absent — see
[User troubleshooting](/guide/troubleshooting-playbook.md).

**`infeasible` therefore never means "short-staffed".** It means the *hard*
constraints contradict each other: capabilities, availability, rest rules, day
caps, closed workstations. That narrows diagnosis considerably — see
[Infeasibility playbook](/solver/infeasibility-playbook.md).

**Priority decides who absorbs the shortfall.** Since shortfall is a cost weighted
by workstation priority, setting everything to `high` removes the solver's ability
to protect critical posts and spreads the shortage evenly instead.

# Related

* [Constraint model](/solver/constraint-model.md) - the full list of hard rules
* [Objective terms](/solver/objective-terms.md) - where the shortfall penalty sits
* [Workstation](/concepts/workstation.md), [Shift](/concepts/shift.md)
