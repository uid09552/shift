# Creating a schedule

This is the main event. Open **Planner → Schedule Optimizer**.

![The Schedule Optimizer, showing a calculated plan by
workstation](../assets/screenshots/scheduler.png)

## The workflow in one picture

```mermaid
flowchart LR
    A[Check your data<br/>is up to date] --> B[Set the period<br/>and options]
    B --> C[Calculate Plan]
    C --> D[Review<br/>the proposal]
    D --> E{Happy?}
    E -->|No| F[Adjust and<br/>recalculate]
    F --> C
    E -->|Almost| G[Fix single days<br/>by hand]
    G --> H[Take as Plan]
    E -->|Yes| H
    H --> I[Confirmed roster]
```

The important thing to understand: **a calculated plan is only a proposal.** It
sits to one side, harming nothing, until you press **Take as Plan**. You can
calculate as many as you like and compare them.

---

## Step 1 — Check your data first

Two minutes here saves an hour of confusion later:

- Are this period's **holidays and sickness** entered? ([Managing your
  staff](people.md))
- Have any **new colleagues** been added, and do they have their
  qualifications ticked?
- Are the **workstations** you want staffed marked *Available*?

The planner can only work with what it has been told.

## Step 2 — Set the period and options

The toolbar across the top of the Schedule Optimizer controls what gets
calculated.

| Control | What it does |
|---|---|
| **Workstations / Employees** | Switches how the result is displayed. It has no effect on the calculation — flip between them freely. |
| **Weeks / Date range** | *Weeks* plans a number of weeks starting from now (2, 4, 6…). *Date range* lets you pick an exact start and end date. |
| **Plan `4w`** | How many weeks ahead to plan, when in *Weeks* mode. |
| **Match monthly hours** | Tick this to make the planner work hard at hitting each person's contracted monthly hours. Leave it off when planning a short stretch that isn't a whole month, where the target doesn't mean much. |
| **All Employees** | Restricts the calculation to a subset of staff. Useful for planning one team separately; leave it on *All Employees* for a normal ward roster. |

!!! tip "How far ahead to plan"
    Four weeks is the usual choice. Planning further ahead gives the planner
    more room to even out the workload, but everything beyond a few weeks
    tends to be invalidated by real life anyway.

## Step 3 — Calculate

Press **Calculate Plan**. The button changes to *Calculating…*.

The work happens in the background, so you can carry on using other pages
while you wait. Typical wards take a few seconds to a couple of minutes; the
time limit is set in [Planner Settings](how-planning-works.md#the-settings-page)
and defaults to two minutes.

Press **Jobs** to see the queue of calculation runs, their status, and any
error message.

### The result line

When it finishes, a summary line appears above the calendar:

> **Period:** Jul 25, 2026 – Aug 21, 2026  **Score:** −17576600.00  **Status:** feasible

| Field | How to read it |
|---|---|
| **Period** | The dates covered. |
| **Score** | The planner's internal quality number. It is only meaningful compared with another run over the *same* period and settings — a higher (less negative) score is better. Ignore it otherwise. |
| **Status** | The one that matters. See below. |

| Status | Meaning |
|---|---|
| **optimal** | The planner proved no better roster exists under your rules. |
| **feasible** | A valid roster that obeys every hard rule — but the planner ran out of time before it could prove it was the best. In practice this is a perfectly good roster, and it is what you will normally see on a busy ward. |
| **infeasible** | Your rules contradict each other; no legal roster exists at all. Nothing was produced. See [When something looks wrong](troubleshooting.md#the-status-says-infeasible). |

!!! note "'feasible' is not a warning"
    On a ward of any size the planner almost always hits its time budget
    before exhausting every possibility. `feasible` means *valid and good*,
    not *incomplete*. If you want it to try harder, raise the time limit in
    Planner Settings.

## Step 4 — Review the proposal

Two views of the same result, chosen with the **Workstations / Employees**
toggle.

**By workstation** — for each place and each day, which shifts run and how many
people are on them. This is the view for answering *"is the emergency room
covered on Saturday?"*

![The proposal grouped by workstation](../assets/screenshots/scheduler.png)

**By employee** — one row per person, one column per day, showing their shift
and where they're working. This is the view for answering *"is this fair, and
does anyone have a horrible week?"*

![The proposal grouped by employee](../assets/screenshots/scheduler-employees.png)

Use the **Today / ‹ / ›** buttons to walk through the weeks of the plan.

What to look for:

- **Thin days.** A workstation showing fewer people than you expect is the
  planner telling you it couldn't do better. Cross-check against who was away.
- **Unlucky individuals.** Scan the employee view for someone with an
  unreasonable run of nights or weekends. The planner does balance workload,
  but it balances it against everything else it's weighing up.
- **Empty rows.** A person with nothing at all usually means their
  qualifications or available shifts don't match anything you asked for.

## Step 5 — Fix individual days by hand

You do not have to accept the proposal wholesale. Switch to the **Employees**
view — hand editing only works there — and **right-click a day, or an
employee's name**. An *Edit Assignment* box opens:

| Status | Effect |
|---|---|
| **Assigned** | The person works. Choose the shift and the workstation. |
| **Free (day off)** | The person is explicitly off that day. |
| **Unassigned (no entry)** | Removes the entry altogether. |

Right-clicking a *name* rather than a day edits that person across the plan;
right-clicking a single square edits just that day.

Hand edits apply to the proposal you are looking at, so you can tidy it up
before confirming.

## Step 6 — Confirm it

Press **Take as Plan**.

!!! warning "This overwrites the confirmed roster for that period"
    Confirming replaces any existing confirmed plan for the dates covered.
    Hand edits that someone made directly in the Schedule calendar for those
    days will be replaced too. If you have been patching this month's roster
    by hand, check the [Schedule](calendars.md) view before confirming a plan
    that overlaps it.

### Confirming only some people

In the **Employees** view each row has a tickbox. Tick a few people and a bar
appears at the top of the table with three buttons:

| Button | Effect |
|---|---|
| **Take as Plan** | Confirms the proposal **for the ticked people only**, leaving everyone else's existing roster untouched. |
| **Clear Assignments** | Removes the ticked people's assignments from the proposal. |
| **Clear Selection** | Unticks everyone. |

This is how you adopt a recalculated roster for the two departments that
changed without disturbing the rest of the ward.

Once confirmed, the roster appears in **Schedule**, **Employee Calendar**,
**Workstation Calendar** and on the dashboard. That is the official plan.

---

## Common variations

**Replanning mid-month after several people go off sick.** Use *Date range*,
from today to the end of the month, and calculate. Review carefully — the
first days may shuffle people who already know their shift. Fix those days by
hand before confirming.

**Planning one team separately.** Use the **All Employees** dropdown to select
just that team's members. Note that the planner will then only see those
people, and will report shortfalls at every workstation the others normally
cover.

**Comparing two options.** Calculate a plan, look at it, change one setting,
calculate again. Both runs are kept and listed under **Jobs**; neither affects
the confirmed roster until you press *Take as Plan*.

## Next

To understand *why* the planner made the choices it did — and how to change
its priorities — read [How the automatic planner
decides](how-planning-works.md).
