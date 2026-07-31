---
type: Task Guide
title: Managing Your Staff
description: Recording qualifications, workable shifts, absences and shift wishes — and the two distinctions that decide whether a roster fills.
tags: [user-guide, staff, absences, wishes]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/guide/people.md
    author: human:maxrg
    last_modified: 2026-07-31
---

The screen you return to most often. **Configuration → User Profiles**.

# Name, email and hours

| Field | What to put in it |
|---|---|
| **Name** | As it should appear on the roster |
| **Email** | Their work address; also how the system recognises them if they sign in |
| **Max working hours (per month)** | Their contracted monthly hours |

The hours figure is a **target, not a ceiling**. The planner aims each person near
their number and treats going over and going under as equally bad. Someone at 160
hours gets roughly twice as much work as a part-timer at 80 — that is the main
mechanism by which part-time contracts are respected.

# Capabilities

Tick every qualification the person actually holds. This is what makes them
eligible for workstations: a workstation requiring *Intensive care* and
*Ventilation* is open only to people with **both**.

Be accurate rather than generous. An untidy capability list is the single most
common reason a roster comes back thin.

# Available shifts

Tick the shift types this person works **at all**. This is the contractual answer,
not a weekly preference. A day-only contract has the night shift permanently
unticked. Somebody merely hoping for early shifts next week should have all their
shifts ticked and a **shift wish** instead.

# Leave and unavailability

The bottom half of the form is a calendar. Click a day to mark it; entries appear
in the list on the right, where they can be removed.

| Tab | Use it for |
|---|---|
| **Unavailable** | Any day the person cannot work — courses, secondments, parental duties |
| **Vacation** | Approved annual leave |
| **Sick Leave** | Recorded sickness |

The three appear in different colours across the calendars.

## Hard absence vs. a preference

Beneath the tabs: **"Soft preference — the optimizer may still schedule this if
needed"**.

* **Unticked** (the normal case) — the day is *blocked*. The planner will not
  schedule this person, whatever the consequences. This is what "I am on holiday"
  means.
* **Ticked** — the day is a *wish to be off*. The planner avoids it and overrides
  it only if the alternative is leaving a post unstaffed.

Getting this wrong degrades the roster in both directions: marking every
preference as a hard absence gradually makes the ward impossible to staff; marking
a real holiday as soft means someone may be rostered while abroad. See
[Unavailability](/concepts/unavailability.md).

# Shift wishes

The positive version: *"I'd like the early shift on the 14th."*

Wishes are set from the **Employee Calendar**, not this form. Open **Planner →
Employee Calendar**, choose the person, click an empty day.

| Menu section | What it does |
|---|---|
| **Assign shift** | Puts the person on that shift, definitively. A decision, not a request |
| **Wish shift (optimizer)** | Records a *preference*. The planner is rewarded for granting it but may decide otherwise |
| **Workstation** | Sets where the assignment applies |

Wishes show as an outlined, star-marked chip, so a granted wish and a plain
assignment are distinguishable. Hover to reveal a delete button. One wish per
person per day. See [Shift wish](/concepts/shift-wish.md).

**Collecting wishes before you plan.** The natural rhythm is: gather requests
during the month, enter them as wishes and soft preferences, then calculate. The
planner grants as many as it can and says nothing about the ones it could not — so
a scan of the finished roster is still worth your time.

# Keeping the list tidy

* **Record sickness as it happens.** A roster calculated on Monday cannot know
  about Tuesday's absence; one recalculated on Wednesday will work around it.
* **Review capabilities after training.** Newly qualified staff stay invisible to
  the planner until someone ticks the box.
* **Don't delete people who leave** until the plans referring to them no longer
  matter — historical rosters reference them.

# Next

[Creating a schedule](/guide/creating-a-schedule.md).
