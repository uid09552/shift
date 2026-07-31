---
type: Glossary
title: Glossary
description: Every term the Shift Planner application uses, defined, with a link to the concept that owns it.
tags: [terminology, onboarding]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/guide/glossary.md
    author: human:maxrg
    last_modified: 2026-07-31
---

Terms as they appear in the UI and in this bundle. The UI is written for ward
staff, so several concepts have both a plain-language name and a technical one —
both are listed, cross-referenced.

**Absence** — a day somebody cannot work: *Unavailable*, *Vacation* or *Sick
Leave*. See [Unavailability](/concepts/unavailability.md).

**Active shifts** — the shifts that actually run at a
[workstation](/concepts/workstation.md). Stored as `active_shift_ids`.

**Assistant** — the in-app chat window. Technically the LangGraph agent; see
[Agent and MCP service](/architecture/agent-and-mcp-service.md).

**Available shifts** — which shift types a person works *at all*. A contractual
fact, not a weekly preference. See [Employee](/concepts/employee.md).

**Capability** — a qualification, skill or licence. Decides who may work where.
See [Capability](/concepts/capability.md).

**Confirmed plan** — the official roster. See
[Confirmed shift plan](/concepts/confirmed-shift-plan.md).

**Feasible** — solver status: valid under every hard constraint, but not proven
optimal before the time limit expired. A normal, usable result. See
[Constraint model](/solver/constraint-model.md).

**Free days after** — compulsory days off following a shift
(`free_days_after_shift`). See [Shift](/concepts/shift.md).

**Hard absence** — an absence the solver will never override. The default. As
opposed to a soft preference.

**Infeasible** — solver status: the hard constraints contradict each other and no
roster exists. See [Infeasibility playbook](/solver/infeasibility-playbook.md).

**Job** — one optimization run. Stored as a
[planning task](/concepts/planning-task.md).

**Max staffing** — the ceiling on headcount for a shift or workstation. A hard
constraint, never exceeded.

**Min staffing** — the headcount you want. A *soft* target, not a limit. See
[Soft minimum, hard maximum](/architecture/soft-minimum-hard-maximum.md).

**Monthly working hours** — a person's contracted monthly target. Over- and
under-shooting are penalised equally.

**Optimal** — solver status: proven that no better roster exists under the given
rules.

**Optimizer / planner** — the CP-SAT service that calculates rosters. See
[Optimizer service](/architecture/optimizer-service.md).

**Organisation** — the ward or hospital whose data you are working on. The
user-facing name for a [tenant](/concepts/tenant.md).

**Planner Settings** — the per-tenant solver configuration. See
[Planner settings reference](/solver/planner-settings-reference.md).

**Priority** — `high`, `medium` or `low` on a workstation. Decides which posts
are staffed first when staff run short.

**Proposal** — a calculated but unconfirmed roster. See
[Optimized shift result](/concepts/optimized-shift-result.md).

**Score / objective value** — the solver's internal quality number. Comparable
only between runs of the same model over the same period.

**Shift** — a named work period with times set per weekday. See
[Shift](/concepts/shift.md).

**Shift assignment** — a pre-arranged fixed commitment the solver must plan
around. See [Shift assignment](/concepts/shift-assignment.md).

**Shift wish** — a request to work a particular shift on a particular day.
Rewarded, never forced. See [Shift wish](/concepts/shift-wish.md).

**Short name** — a shift's one- or two-character calendar abbreviation.

**Skill group / skill level** — optional fields marking a capability as one rank
of a ranked family, enabling the skill-downgrade objective.

**Soft preference** — an absence flagged `is_soft_preference: true`. Avoided, but
overridable rather than blocking.

**Take as Plan** — promotes an optimizer result into the confirmed roster,
overwriting whatever was confirmed for that period.

**Tenant** — the isolation boundary. Every table carries `tenant_id`. See
[Tenant](/concepts/tenant.md) and
[Tenant isolation](/architecture/tenant-isolation.md).

**Workstation** — a place that must be staffed. See
[Workstation](/concepts/workstation.md).
