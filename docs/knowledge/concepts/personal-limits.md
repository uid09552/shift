---
type: Domain Concept
title: Personal Limits
description: Per-employee caps the planner respects — max nights and max weekends per month, no nights at all, preferred weekdays off — hard or soft by personal_limits_mode, plus the protected-group data the labor-law profile uses.
resource: src/services/personal_limits.rs
tags: [domain, employee, limits, nights, weekends, max-nights-per-month, preferred-days-off]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-30T00:00:00Z
sources:
  - resource: openspec/specs/personal-limits/spec.md
    author: human:maxrg
    last_modified: 2026-10-08
---

Some people may not, or should not, work everything. Their **personal limits**
are set per [employee](/concepts/employee.md) on the Employees page.

| Limit | Means | How it binds |
|---|---|---|
| `max_nights_per_month` | at most this many night shifts per calendar month | hard or soft, by `personal_limits_mode` |
| `max_weekends_per_month` | at most this many weekends worked per calendar month | hard or soft, by `personal_limits_mode` |
| `no_night_shifts` | never a night shift | always hard |
| `preferred_days_off` | weekdays the person would rather not work | soft: costs `preference_weight`, never forbids |

`personal_limits_mode` is a planner setting:

* **hard** (default) — the caps are never exceeded; a shift stays short instead.
* **soft** — a cap may be exceeded only to fill a slot that would otherwise stay
  short, as little as possible, and every excess is named in the result's
  `message`.

The assistant's plan check (*Verify Plan*) flags breaches of all four.

# Protected-group data

The same record may hold a **date of birth** and a **maternity protection**
flag. Only the [labor-law profile](/concepts/labor-law-profile.md) uses them
(young workers, maternity protection). Only planners and admins can read or
change them; a viewer never sees them, the audit log records only *that* they
changed, and findings name the law — never the reason a person is protected.
