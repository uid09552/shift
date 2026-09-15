---
type: Task Guide
title: Signing In and Finding Your Way Around
description: Logging in, choosing an organisation, the layout of every page, and how to read the dashboard.
tags: [user-guide, onboarding, dashboard]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/guide/first-steps.md
    author: human:maxrg
    last_modified: 2026-07-31
---

# Signing in

Open the address your administrator gave you, typically something like
`https://planner.your-hospital.example/`.

1. Type your **username or email address** and press **Sign In**.
2. If you work for more than one organisation, **choose an organisation** — the
   one whose roster you want to work on.
3. Type your **password** and press **Sign In** again.

The system can hold several wards or hospitals side by side, completely separated.
Whichever organisation you pick, you see only that organisation's data. Picking
the wrong one is harmless — sign out and back in to switch. Technically this is a
[tenant](/concepts/tenant.md).

Sessions expire. If lists suddenly appear empty or your name disappears from the
top right, reload the page and sign in again. Nothing is lost.

Passwords, accounts and permissions are managed outside this app. If you can sign
in but a page refuses to save, you probably have the read-only role — see
[Gateway and identity](/architecture/gateway-and-identity.md).

# The screen

**Left — the menu.** Three groups:

| Group | What lives there |
|---|---|
| **Dashboard** | *Overview* — the summary screen you land on |
| **Configuration** | User Profiles, Shifts, Workstations, Capabilities, Planner Settings |
| **Planner** | Schedule (day, week, month), Employee Calendar, Schedule Optimizer |

Roughly: **Configuration** describes the world, **Planner** works with it.

**Top — the header.** Search box, light/dark toggle, notifications bell, your
name. Click your name to sign out.

**Bottom right — the assistant.** The round speech-bubble button. See
[Using the assistant](/guide/using-the-assistant.md).

# Reading the dashboard

| Panel | What it tells you |
|---|---|
| **Employees / Shifts / Workstations** | How many of each are on file. Click a card to jump to that list |
| **Planned Hours per Day** | A bar per day of the current month. Gaps mean nobody is scheduled |
| **Today's Coverage** | Who is working, who is on leave or sick, and per workstation assigned-against-required |
| **Latest Optimization Run** | Whether the last calculation finished, and when |
| **Recent Activity** | The last few changes anyone made |

**Planned Hours per Day is the quickest health check you have.** A month ending in
a run of empty bars is a month nobody has planned yet.

**Recent Activity** is the first place to look when something changed and nobody
admits to it — it is backed by the [audit log](/concepts/audit-log.md).

# Where to go next

If the ward has not been set up: [Ward setup](/guide/ward-setup.md).
If it already has staff and shifts: [Creating a schedule](/guide/creating-a-schedule.md).
