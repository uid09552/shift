# When something looks wrong

Nearly every problem in practice is one of a handful. This page lists them in
the order they come up.

---

## The status says "infeasible"

**What it means.** Your rules contradict each other. There is no roster at all
that satisfies everything you have asked for, so the planner produced nothing.
This is not a crash; it is an answer.

**What causes it**, in rough order of likelihood:

1. **A workstation requires a combination of capabilities nobody holds.**
   Remember that required capabilities are *all of them*, not *any of them*.
   Open the workstation and check the list against your staff.
2. **A shift has no times on a weekday it needs to run.** If Sunday is
   unticked on the shift, that shift does not exist on Sundays — but a
   workstation may still be demanding it.
3. **The rest and recovery limits are too tight for your headcount.** *Max
   days per week*, *Max consecutive days* and *Night shift recovery* multiply
   together. Four people cannot cover a 24/7 post at five days a week.
4. **Minimum rest makes a required sequence impossible.** With 11 hours'
   rest, a late shift ending at 22:00 rules out an early shift starting at
   06:00 the next morning. If your only night-shift-capable person also has to
   do the following early, there is no legal answer.
5. **Absences have removed the only qualified person from a mandatory post.**

**How to find it.** Relax one thing at a time and recalculate:

- Set *Max days per week* to `0` (unlimited) and try again. If it now works,
  the limits were the problem.
- Untick one required capability on the workstation you suspect. If it now
  works, you know where to look.

---

## A workstation is always understaffed

The status is fine, but a place keeps coming back with fewer people than you
asked for.

| Check | Why |
|---|---|
| Who actually holds its **required capabilities**? | The eligible pool may be two people. |
| Are those people **available for the shifts** it runs? | Somebody with the right skills but no night shift ticked cannot cover nights. |
| Its **priority** | If it is `Low` and the ward is short, it loses by design. |
| Its **Min** staffing | Is the number you asked for realistic for your headcount? |
| Absences in that period | Three of five qualified people on leave explains a lot. |

Remember minimum staffing is a *goal*, not a rule — the shortfall you are
looking at is the planner reporting that it could not do better, not a bug.

---

## Somebody is barely scheduled at all

Almost always one of:

- **No capabilities ticked** on their profile — they are eligible for nothing.
- **Few available shifts** ticked — they only fit a narrow slot.
- **A low monthly hours figure** — they are being scheduled correctly for a
  part-time contract.
- **A long stretch of unavailability** entered and forgotten about.

Open their profile and their Employee Calendar side by side; the cause is
usually obvious within a few seconds.

---

## The roster is unfair

One person has all the nights, or all the weekends.

- Check how many people have that shift ticked as **available**. If three
  people out of forty can work nights, no amount of fairness weighting will
  spread them further.
- Raise the **fairness weight** in [Planner
  Settings](how-planning-works.md#objective-weights) and recalculate.
- Raise the **time limit**. On a busy ward a `feasible` result is the best
  found before the clock ran out; more time often produces a visibly better
  balance.

---

## People are rotated between shifts every day

Legal, but exhausting. Raise the **shift continuity weight** and the
**week-streak bonus** in Planner Settings, then recalculate.

---

## Everybody is under their contracted hours

Check whether **Match monthly hours** was ticked on the Schedule Optimizer.
Without it, the planner does not push towards each person's target.

If it was ticked, the ward may simply have more staff than the workstations
you described need. The planner will not invent work.

---

## My changes disappeared

Someone confirmed a calculated plan covering the same days. **Take as Plan**
overwrites the confirmed roster for its whole period, including hand edits.

The **Recent Activity** panel on the dashboard shows who changed what and
when.

To avoid it: make large corrections by fixing the underlying data (absences,
availability) and recalculating, rather than by editing the calendar
day-by-day. Or use the tickboxes in the optimizer's Employees view to confirm
a plan for [only some people](creating-a-plan.md#confirming-only-some-people).

---

## Lists are suddenly empty, or my name has vanished

Your session expired. Reload the page and sign in again. Nothing has been
lost — this is only your browser losing its login, not your data going
anywhere.

---

## The calculation never finishes

Open the **Runs** tab on the Schedule Optimizer to see the run and its status. A job
that failed will show an error message there.

Runs stuck for a very long time are cleaned up automatically. If they
consistently fail, the planning service is probably not running — that is one
for your administrator.

---

## Nothing here matches my problem

Collect three things before asking for help, and the answer will come back much
faster:

1. **What you did**, screen by screen.
2. **What you expected**, and what you actually got.
3. **The date and time**, so the run can be found in the job list and the
   activity log.
