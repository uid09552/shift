# Reading and adjusting the schedule

Once a roster is confirmed it appears in three calendars. They show the same
information arranged three different ways — pick whichever answers the
question you actually have.

| View | Answers |
|---|---|
| **Schedule** | *Who is working, and when?* |
| **Employee Calendar** | *What does one person's month look like?* |
| **Workstation Calendar** | *Is this place adequately covered?* |

All three are under **Planner** in the menu, and all three have an **Export
Excel** button in the top right that saves exactly what you are looking at.

---

## Schedule — the master roster

![The weekly schedule](../assets/screenshots/schedule.png)

One row per person, one column per day. Each square shows the shift's short
name and, below it, the workstation. Grey **Free** means a day off.

**Weekly / Monthly** switches the span. Monthly fits the whole month across the
screen; you scroll sideways to reach the end of it.

![The monthly schedule](../assets/screenshots/schedule-monthly.png)

The **legend** along the bottom decodes the abbreviations and colours — the
same colours you chose when setting up each shift.

### Changing a single day

Click any square.

- On a **day off**, a menu opens offering each shift, then each workstation.
  Pick a shift, then a workstation, and the person is scheduled.
- On an **existing assignment**, the same menu lets you switch to a different
  shift or move them to another workstation. A small delete button appears on
  hover to remove the assignment entirely.

Changes take effect immediately — this *is* the confirmed roster, not a
proposal. There is a confirmation step before deleting, but not before
changing.

!!! tip "Hand edits and recalculation"
    Anything you change here is overwritten if someone later confirms a
    calculated plan covering the same dates. For a few corrections that is
    fine. For a large reshuffle, it is safer to fix the underlying data
    (absences, availability) and recalculate.

---

## Employee Calendar — one person's month

![One employee's month](../assets/screenshots/employee-calendar.png)

Choose a person from the dropdown. You get their month laid out as a normal
wall calendar, showing:

- **Shifts** they are working, with the workstation underneath.
- **Absences**, colour-coded: vacation, sick leave, and days marked
  unavailable.
- **Free** days the planner explicitly gave them off.
- **Shift wishes**, drawn as an outlined chip with a star — see [Managing your
  staff](people.md#shift-wishes).

Underneath is an **Hours Summary** with the planned working hours for the
month, which is the quickest way to check whether someone is heading over or
under their contract.

This is the view to print or export when somebody asks "what am I doing next
month?"

### Editing here

Click any empty day for a menu offering **Assign shift**, **Wish shift
(optimizer)** and **Workstation**. Existing entries can be changed or deleted
the same way as in the Schedule view.

---

## Workstation Calendar — coverage by place

![Coverage per workstation](../assets/screenshots/workstation-calendar.png)

One row per workstation, one column per day. Each cell lists the shifts
running there that day with the **number of people assigned** to each.

This is the view for spotting holes. Reading across a row tells you whether a
unit is consistently covered; reading down a column tells you how a particular
day is shaping up.

Compare the numbers here against the **Min** you set on the shift and the
workstation. A day showing `1` where you asked for `3` is a real shortfall the
planner could not fill.

---

## Exporting

Every calendar has an **Export Excel** button that exports the current view —
the week or month you are looking at, in the arrangement you are looking at.

Use it to:

- print or circulate the roster;
- send one person their own month from the Employee Calendar;
- keep an archive copy before recalculating a period.

---

## The dashboard as a quick check

Before you go digging through calendars, the **Dashboard** often answers the
question already: today's coverage per workstation, how many people are on
leave, and the planned-hours-per-day chart that reveals unplanned stretches at
a glance. See [First steps](first-steps.md#the-dashboard-explained).
