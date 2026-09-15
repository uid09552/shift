---
type: Task Guide
title: Reading and Adjusting the Schedule
description: The four calendar views, which question each answers, how to change a single day, and what hand edits survive.
tags: [user-guide, calendars, roster, editing]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/guide/calendars.md
    author: human:maxrg
    last_modified: 2026-07-31
---

Once a roster is confirmed it appears in four calendars — the same information
arranged four ways. Pick whichever answers the question you actually have.

| View | Answers |
|---|---|
| **Schedule**, Week (default) or Month | *Who is working, and when?* |
| **Schedule**, Day | *Who is on the ward at three o'clock?* |
| **Employee Calendar** | *What does one person's month look like?* |

*Is this place adequately covered?* is the Schedule read **By workstation**, one
of its three lenses over the same confirmed plans (By employee, By workstation,
By shift). All three views are under **Planner**, and each has an **Export
Excel** button that saves exactly what you are looking at.

# Schedule — the master roster

One row per person, one column per day. Each square shows the shift's short name
and, below it, the workstation. Grey **Free** means a day off. **Weekly /
Monthly** switches the span; monthly scrolls sideways. The legend along the bottom
decodes the abbreviations and colours.

## Changing a single day

Click any square.

* On a **day off**, a menu offers each shift, then each workstation.
* On an **existing assignment**, the same menu switches shift or workstation. A
  small delete button appears on hover.

**Changes take effect immediately — this *is* the confirmed roster, not a
proposal.** There is a confirmation step before deleting, but not before changing.

Anything changed here is overwritten if someone later confirms a calculated plan
covering the same dates. For a few corrections that is fine. For a large reshuffle
it is safer to fix the underlying data — absences, availability — and recalculate.

# Day — one day, hour by hour

**Daily** on the Schedule page (`/kalender?view=day`); its arrows page one day
at a time, and clicking a day's heading in the week or month opens that day.

One row per person, and across the top a 24-hour ruler rather than a row of days.
Each shift is a coloured bar spanning the hours it actually runs, labelled with
the shift and the workstation. This is the view for questions about *time of day*
rather than about dates — who is on the ward mid-afternoon, whether the handover
between late and night is covered, who is around when the CT list overruns.

* **The bars are drawn from the shift's times for that weekday**, so a shift
  configured differently on Saturdays is drawn differently on Saturdays.
* **A shift running past midnight is cut off square at the right edge** and marked
  ↦; its remainder appears at the left edge of the following day, marked ↤. A
  night shift is therefore visible on both of the days it touches, which is how
  the ward actually experiences it.
* **Absences** stretch across the whole row in their own colour, labelled with the
  reason.
* **A red line marks the current time** when the day on screen is today.
* **Zoom** (− / +) changes how many pixels an hour gets; the chart scrolls
  sideways at every zoom level, with the name column pinned.
* **Only scheduled** hides everyone with nothing that day, turning a long staff
  list into just the people on duty.

The header counts how many are on duty, how many are away, and the total planned
hours for the day. Searching in the top bar filters the rows by name.

# Employee Calendar — one person's month

Choose a person from the dropdown for their month as a wall calendar:

* **Shifts** they are working, with the workstation underneath.
* **Absences**, colour-coded: vacation, sick leave, unavailable.
* **Free** days the planner explicitly gave them.
* **Shift wishes**, as an outlined chip with a star.

Underneath, an **Hours Summary** with planned working hours for the month — the
quickest way to check whether someone is heading over or under their contract.

This is the view to export when somebody asks "what am I doing next month?"

Click any empty day for **Assign shift**, **Wish shift (optimizer)** and
**Workstation** — see [Staff management](/guide/staff-management.md).

# Coverage by place — the Schedule's workstation lens

Switch the Schedule to **By workstation**: one row per workstation, one column
per day; each cell lists the shifts running there with the **number of people
assigned**. (The standalone *Workstation Calendar* page was removed — it showed
the same plans, read only and one week at a time. Old links redirect here.)

This is the view for spotting holes. Reading across a row tells you whether a unit
is consistently covered; reading down a column tells you how a particular day is
shaping up.

Compare the numbers against the **Min** you set on the shift and the workstation.
A day showing `1` where you asked for `3` is a real shortfall the planner could
not fill — not a display error. See
[Soft minimum, hard maximum](/architecture/soft-minimum-hard-maximum.md).

# Exporting

Every calendar exports the current view — the week or month on screen, in the
arrangement on screen. Use it to print or circulate the roster, send one person
their own month, or keep an archive copy before recalculating a period.

# The dashboard as a quick check

Before digging through calendars, the **Dashboard** often answers the question
already: today's coverage per workstation, how many people are on leave, and the
planned-hours-per-day chart that reveals unplanned stretches at a glance. See
[Signing in](/guide/signing-in.md).
