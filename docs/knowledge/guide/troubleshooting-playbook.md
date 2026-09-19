---
type: Playbook
title: When Something Looks Wrong
description: The handful of problems that actually come up in practice, what causes each, and what to check first.
tags: [user-guide, troubleshooting, playbook]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/guide/troubleshooting.md
    author: human:maxrg
    last_modified: 2026-07-31
---

Nearly every problem in practice is one of these, in roughly this order.

# The status says "infeasible"

Your rules contradict each other. No roster satisfies everything you asked for, so
nothing was produced. This is an answer, not a crash.

Causes, in order of likelihood:

1. **A workstation requires a combination of capabilities nobody holds.** Required
   capabilities are *all of them*, not *any*. Check the list against your staff.
2. **A shift has no times on a weekday it needs to run.** If Sunday is unticked on
   the shift, that shift does not exist on Sundays — but a workstation may still be
   demanding it.
3. **Rest and recovery limits too tight for your headcount.** *Max days per week*,
   *Max consecutive days* and *Night shift recovery* multiply together. Four people
   cannot cover a 24/7 post at five days a week.
4. **Minimum rest makes a required sequence impossible.** At 11 hours, a late
   ending 22:00 rules out an early starting 06:00.
5. **Absences have removed the only qualified person from a mandatory post.**

**How to find it.** Relax one thing at a time and recalculate. Set *Max days per
week* to `0` (unlimited) and retry — if it works, the limits were the problem.
Untick one required capability on the suspect workstation — if it works, you know
where to look. Full procedure in
[Infeasibility playbook](/solver/infeasibility-playbook.md).

# A workstation is always understaffed

Status is fine, but a place keeps coming back thin.

| Check | Why |
|---|---|
| Who actually holds its **required capabilities**? | The eligible pool may be two people |
| Are those people **available for the shifts** it runs? | Right skills but no night shift ticked cannot cover nights |
| Its **priority** | If it is `Low` and the ward is short, it loses by design |
| Its **Min** staffing | Is the number realistic for your headcount? |
| Absences in that period | Three of five qualified people on leave explains a lot |

Minimum staffing is a *goal*, not a rule — the shortfall is the planner reporting
it could not do better, not a bug.

# Somebody is barely scheduled at all

Almost always one of: **no capabilities ticked** (eligible for nothing), **few
available shifts**, **a low monthly hours figure** (correct for a part-time
contract), or **a long stretch of unavailability** entered and forgotten. Open
their profile and their Employee Calendar side by side; the cause is usually
obvious in seconds.

# The roster is unfair

One person has all the nights or all the weekends.

* Check how many people have that shift ticked as **available**. If three out of
  forty can work nights, no amount of fairness weighting spreads them further.
* The **Fairness** page (Planner → Fairness) shows it: sort by *Nights* or
  *Weekend days*.
* Raise **Fairness** (section *Fairness & Hours*) in Planner Settings, or pick the
  *Equal share* preset, and recalculate.
* Set **Search effort** to *Thorough*. A `feasible` result is the best found
  before the clock ran out; more time often produces a visibly better balance.

# People are rotated between shifts every day

Legal, but exhausting. Raise **Shift continuity** and the **Week-streak bonus**
(section *Coverage & Continuity*), or pick the *Stable rosters* preset, then
recalculate.

# Everybody is under their contracted hours

Check whether **Match monthly hours** was ticked on the Schedule Optimizer.
Without it the planner does not push towards each person's target. If it was
ticked, the ward may simply have more staff than the workstations you described
need — the planner will not invent work.

# My changes disappeared

Someone confirmed a calculated plan covering the same days. **Take as Plan**
overwrites the confirmed roster for its whole period, including hand edits. The
**Recent Activity** panel on the dashboard shows who changed what and when.

To avoid it: make large corrections by fixing the underlying data and
recalculating, rather than editing day by day. Or use the tickboxes in the
optimizer's Employees view to confirm a plan for
[only some people](/guide/creating-a-schedule.md).

# Lists are suddenly empty, or my name has vanished

Your session expired. Reload and sign in again. Nothing is lost — this is your
browser losing its login, not your data going anywhere.

# The calculation never finishes

Press **Jobs** on the Schedule Optimizer to see the run and its status; a failed
job shows an error message. Runs stuck for a very long time are cleaned up
automatically. If they consistently fail, the planning service is probably not
running — one for your administrator, who should check
[NATS subjects](/interfaces/nats-subjects.md).

# Nothing here matches my problem

Collect three things before asking for help:

1. **What you did**, screen by screen.
2. **What you expected**, and what you got.
3. **The date and time**, so the run can be found in the job list and the activity
   log.
