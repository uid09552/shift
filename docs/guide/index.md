# User Guide

This guide is for the people who actually build the duty roster: ward
managers, team leads, staffing coordinators and anyone in the office who has
to answer the question *"who is working on Tuesday?"*

You do not need to know anything about computers beyond using a web browser.
There is no jargon here that isn't explained, and every screen shown is the
real screen you will see.

!!! tip "Looking for the technical documentation?"
    The rest of this site describes how the software is built and deployed.
    If you are a developer or administrator, start at
    [Architecture](../architecture.md) instead.

## What this software is for

A hospital ward runs around the clock. Every day, every shift, someone
qualified has to be standing in each place that needs staffing. Building that
roster by hand means holding a lot of rules in your head at once:

- Sabine is trained for intensive care, Thomas is not.
- Nobody may work a late shift and then an early shift the next morning.
- After a night shift, people get two days off.
- Everybody has a contracted number of hours per month, and it should come
  out roughly even — not one person doing every weekend.
- The emergency room *must* be staffed. The day clinic can wait if it has to.
- Three people are on holiday and one is off sick.

A spreadsheet cannot check any of that for you. This software can. You tell it
the rules once, keep the staff list up to date, and it produces a complete,
legal, fair roster for the coming weeks — in seconds. You then look it over,
change anything you disagree with, and confirm it.

**The software proposes. You decide.** Nothing it calculates goes into the
official plan until you press a button.

![The dashboard, showing headcount, planned hours per day, today's coverage
and the most recent planning run](../assets/screenshots/dashboard.png)

## What it does not do

It is worth being clear about the limits:

- It does not talk to your payroll or time-clock system. Hours shown are
  *planned* hours, not hours actually worked.
- It does not know about anything you have not told it. If a qualification
  isn't recorded, the software will happily schedule someone who shouldn't be
  there.
- It does not send messages to staff. Sharing the roster is still up to you —
  though every calendar can be exported to Excel with one click.

## How the work is divided up

Using the system falls into three quite different activities. Most of your
time will be spent on the second and third.

| | What it is | How often |
|---|---|---|
| **Set up** | Describing your ward once: qualifications, shift types, workstations, staff | Once, then rarely |
| **Keep current** | Holidays, sickness, new colleagues, shift wishes | Weekly |
| **Plan** | Calculate a roster, review it, confirm it | Monthly, or whenever you plan ahead |

## Where to start

<div class="grid cards" markdown>

- **[First steps](first-steps.md)** — signing in and finding your way around
  the screen.
- **[Setting up your ward](setup.md)** — the one-time job of describing
  qualifications, shifts and workstations.
- **[Managing your staff](people.md)** — who can do what, who is away, who
  would like which shift.
- **[Creating a schedule](creating-a-plan.md)** — the main workflow, step by
  step.
- **[Reading and adjusting the schedule](calendars.md)** — the three calendar
  views and how to change a single day.
- **[How the automatic planner decides](how-planning-works.md)** — what the
  computer is actually weighing up, in plain language.
- **[The built-in assistant](assistant.md)** — asking the app questions in
  ordinary sentences.
- **[When something looks wrong](troubleshooting.md)** — the handful of
  problems that come up in practice, and what causes them.
- **[Glossary](glossary.md)** — every term this app uses, defined.

</div>
