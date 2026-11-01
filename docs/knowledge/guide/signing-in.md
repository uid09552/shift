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

The overview you land on depends on your role.

**Planners and admins** see, top to bottom:

| Panel | What it tells you |
|---|---|
| **Needs you** | What is waiting for a planner, each line a link to where it is handled: shift swaps to approve, roster changes the people concerned have not seen yet, months due for publishing, and an automatic plan that stayed a proposal or failed. When nothing is open it says so |
| **Coverage, next 7 days** | Today and the next six days by shift, staffed against the minimum. A red cell with a warning sign is short — the shift, or a workstation running it. Click it to open that day in the Schedule |
| **My day** | Your own confirmed shift and who else is on |
| **Latest Optimization Run** | Whether the last calculation finished, and when |
| **Recent Activity** | The last few changes anyone made |

**Coverage is counted exactly as *Verify Plan* and the Analytics report count
it**, so a short cell here is a short cell there.

**Recent Activity** is the first place to look when something changed and nobody
admits to it — it is backed by the [audit log](/concepts/audit-log.md).

**Viewers** see their own day, the changes to their published shifts they have
not marked *Seen* yet, their open shift swaps (the ones waiting for their answer
first), and — while wishes can be placed — for which days.

# Where to go next

If the ward has not been set up: [Ward setup](/guide/ward-setup.md).
If it already has staff and shifts: [Creating a schedule](/guide/creating-a-schedule.md).
