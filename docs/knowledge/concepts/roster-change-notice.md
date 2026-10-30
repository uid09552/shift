---
type: Domain Entity
title: Roster Change Notice
description: What tells an employee that their shift in an already published roster changed — what, by whom, why, from which source — and whether they have read it.
resource: src/services/roster_notice.rs
tags: [domain, roster, notification, published, acknowledge, change-notice]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-30T00:00:00Z
sources:
  - resource: openspec/specs/roster-change-notices/spec.md
    author: human:maxrg
    last_modified: 2026-10-09
---

Once a month is published (see [Roster lifecycle](/concepts/roster-lifecycle.md)),
people rely on it. So every write to a **published or locked** month that
changes someone's entry for a day creates one **change notice** for that
employee and day. Draft months create none.

A notice holds the day, the shift, workstation and absence **before and
after**, the **source**, the **actor**, the time, and the **reason** when one
was given. Sources:

| Source | Means |
|---|---|
| manual | a planner edited the roster |
| take_as_plan | a new proposal was taken as the roster — notices only for the days that differ |
| absence | an absence was recorded |
| swap | an approved [shift swap](/concepts/shift-swap.md) |
| replacement | a [short-notice replacement](/guide/short-notice-replacement.md) |

A write that leaves an entry exactly as it was creates nothing. A notice never
changes afterwards: a later change to the same day gets its own notice, and
deleting the entry leaves the notice in place.

# Reading and acknowledging

Each employee lists their own notices, newest first, sees how many are unread
(the bell), and acknowledges one or all of them — nobody can acknowledge on
someone else's behalf. A `shift-viewer` only ever sees notices about
themselves.

Planners and admins see every notice of the tenant, filtered by employee, date
range and whether it was acknowledged — that is how they find out who has not
yet seen a change. The **Changes** page shows both views; the Analytics page's
*Roster changes* tab charts them over time.

Endpoints: `GET /roster-change-notices` (`listRosterChangeNotices`),
`GET /roster-change-notices/unread-count`, `POST /roster-change-notices/acknowledge`.
