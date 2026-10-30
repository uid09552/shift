---
type: Domain Concept
title: Automatic Planning
description: A planner setting that plans the roster on a schedule (every N weeks, on a weekday, at a time) and takes the result as the roster only when that is safe; otherwise it stays a proposal and the settings page says why.
resource: src/services/auto_plan.rs
tags: [domain, planning, schedule, auto-plan, proposal, take-over]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-30T00:00:00Z
sources:
  - resource: openspec/specs/automatic-planning/spec.md
    author: human:maxrg
    last_modified: 2026-10-25
---

Automatic planning runs the optimizer on a rhythm the ward sets, without anyone
pressing a button. It is part of the [planner settings](/concepts/planner-settings.md)
and **off by default**. Planners and admins change it; everyone may read it.

# The schedule

* **Every N weeks** (1–12), on a **weekday**, at a **time**, counted from a
  **start date** that anchors the cycle.
* **How far ahead**: 2, 4, 6, 8 or 12 weeks, or 1, 2 or 3 calendar months.
* One run per run day, never two — also across restarts and several backend
  instances. A run day whose time had already passed when the schedule was
  switched on or changed does not run.

A run plans from the day after the last confirmed day that has a shift (at
least tomorrow) up to the end of the range. If the roster already reaches that
far, nothing is planned and the outcome says until when it is planned.

It is an ordinary [planning run](/concepts/planning-task.md): every employee,
the current data and settings, labor law included. It is listed among the runs
as *automatic*, and the [audit log](/concepts/audit-log.md) records it under the
actor `auto-planner`.

# When the plan becomes the roster

Only when it is safe. **All** of these must hold:

* the solver status is optimal or feasible, and it reports nothing to flag — no
  slot below minimum staffing, no fixed or locked assignment dropped, no
  personal limit exceeded;
* every month the range touches is still **draft**;
* nobody is planned on a day they have recorded as absent (sick, day off,
  holiday, unknown), and no closed workstation is staffed.

Otherwise the result **stays a proposal**, unchanged, for a planner to review
on the Scheduler page, and the outcome names the reason. Taking over writes
only the plan's own (`automated`) entries — never one a person made — and
never publishes, locks or notifies.

# Outcome

The planner settings report the next run, and the last run's date,
**outcome** and **note** (`auto_plan_last_outcome`, `auto_plan_last_note`):

| Outcome | Means |
|---|---|
| running | the run has started |
| taken_over | the plan became the roster |
| kept_as_proposal | it stayed a proposal — the note says which condition failed |
| skipped | there was nothing to plan |
| failed | it could not start, or the solver failed; nothing was written, the next run day runs as usual |

"Why did the automatic plan stay a proposal?" — read the note: it names the
condition above that did not hold (for instance a slot left short, or a month
already published). Each tenant's schedule and outcome are its own.
