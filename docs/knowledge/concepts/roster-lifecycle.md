---
type: Domain Concept
title: Roster Lifecycle — Draft, Published, Locked, and the Freeze Window
description: Each month of the confirmed roster is draft, published or locked; that status decides who sees it, who may change it, when a change needs a reason (the freeze window, X-Change-Reason, 428 reason_required), and when it is due for publishing.
resource: src/services/roster_guard.rs
tags: [domain, roster, publish, lock, freeze-window, reason, change-reason]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-30T00:00:00Z
sources:
  - resource: openspec/specs/roster-publication/spec.md
    author: human:maxrg
    last_modified: 2026-10-09
---

Every calendar month of a tenant's [confirmed roster](/concepts/confirmed-shift-plan.md)
has one status. A month nobody has touched is **draft**.

| Status | Who sees it | Who may change it |
|---|---|---|
| **draft** | planners and admins only | planners and admins |
| **published** | everyone, viewers included | planners and admins — within the freeze window only with a reason |
| **locked** | everyone | `shift-admin` only, always with a reason |

# Moving between statuses

* **Publish** (draft → published): a planner or admin. Records who and when.
* **Lock** happens by itself once a published month's last day has passed. An
  admin may also lock an ended month by hand. Draft months never lock.
* **Unpublish** (published → draft) and **unlock** (locked → published):
  `shift-admin` only, with a non-empty reason, written to the
  [audit log](/concepts/audit-log.md). An unlocked month stays published until
  an admin locks it again.

# The freeze window and reasons

`freeze_days` (planner setting, default 7, 0 = off) protects the days just
ahead: a change to a **published** month on a day from today up to today +
`freeze_days` − 1 needs a reason. So does any change to a **locked** month.

The reason travels in the `X-Change-Reason` request header, URL-encoded. A
write that needs one and has none is refused with **428 `reason_required`** —
ask the person for their reason and send the same request again with it. The
assistant's tools take the reason as an argument of that name and encode it
themselves.

Every roster write follows these rules, whatever made it: a manual edit,
*Take as Plan*, a recorded absence, an approved [shift swap](/concepts/shift-swap.md),
a [short-notice replacement](/guide/short-notice-replacement.md). A write that
touches several months is refused as a whole if one of them refuses it.

A change to a published or locked month also becomes a
[change notice](/concepts/roster-change-notice.md) for each affected
employee-day — the people concerned are told.

# Publish deadline

`publish_lead_days` (default 28): a draft month whose first day is less than
that many days away is **due**; once it has started it is **overdue**. This is a
warning on the dashboard and the Schedule page — it blocks and publishes
nothing.

# Where to look

`GET /roster-months` (`listRosterMonths`) lists each month's status and
deadline; `POST /roster-months/{YYYY-MM}/publish`, `/unpublish`, `/unlock` and
`/lock` change it. "Why can't I change the 3rd?" is almost always: the month is
published and the 3rd is inside the freeze window (give a reason), or the month
is locked (an admin with a reason).
