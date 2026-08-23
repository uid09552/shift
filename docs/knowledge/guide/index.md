---
type: Directory
title: User Guide
description: The ward manager's view — what the software is for, the three activities it supports, and a task guide for each screen.
tags: [user-guide, workflow, non-technical]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/guide/
    author: human:maxrg
    last_modified: 2026-07-31
---

For the people who build the duty roster: ward managers, team leads, staffing
coordinators. No technical knowledge assumed. These concepts describe the
application as it is used, not as it is built — the same system seen from the
other side of the screen.

# What the software is for

A hospital ward runs around the clock, and somebody qualified must be standing in
each place that needs staffing. Building that by hand means holding too many rules
in your head at once: who is trained for intensive care, who may not work a late
shift followed by an early one, who is owed two days off after nights, whose
contracted hours are being quietly exceeded, which post can wait if the ward is
short, and who is on holiday.

You describe the rules once, keep the staff list current, and the software
produces a complete, legal, balanced roster in seconds.

**The software proposes. You decide.** Nothing it calculates enters the official
plan until someone presses **Take as Plan**.

# What it does not do

* It does not talk to payroll or time-clock systems. Hours shown are *planned*,
  not worked.
* It knows nothing you have not told it. An unrecorded qualification means the
  software will happily schedule someone who should not be there.
* It does not message staff. Circulating the roster is still manual — though every
  calendar exports to Excel in one click.

# The three activities

| | What it is | How often |
|---|---|---|
| **Set up** | Describing the ward once: qualifications, shift types, workstations | Once, then rarely |
| **Keep current** | Holidays, sickness, new colleagues, shift wishes | Weekly |
| **Plan** | Calculate a roster, review it, confirm it | Monthly, or whenever you plan ahead |

Most time goes on the second and third.

# The guides

* [Signing in](/guide/signing-in.md) - logging in, choosing an organisation, and finding your way around the screen.
* [Ward setup](/guide/ward-setup.md) - the one-time job: capabilities, shifts, workstations, and bulk loading from Excel.
* [Staff management](/guide/staff-management.md) - qualifications, workable shifts, absences, and shift wishes.
* [Creating a schedule](/guide/creating-a-schedule.md) - the main workflow, step by step.
* [Reading calendars](/guide/reading-calendars.md) - the three views, editing a single day, exporting.
* [Using the assistant](/guide/using-the-assistant.md) - asking the app for things in ordinary sentences.
* [Importing a roster](/guide/importing-a-roster.md) - handing the assistant a plan you already have as a PDF, CSV or Excel file.
* [User troubleshooting](/guide/troubleshooting-playbook.md) - the handful of problems that actually come up.

Terms are defined in the [Glossary](/glossary.md). The mechanics behind the
proposals are in [Solver](/solver/index.md).
