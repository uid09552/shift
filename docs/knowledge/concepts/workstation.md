---
type: Domain Entity
title: Workstation
description: A ward, unit or post that must be staffed — with required capabilities, a staffing band, a priority, and the shifts that operate there.
resource: src/models/workstation.rs
tags: [domain, workstations, coverage]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/domain-model.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: docs/guide/setup.md
    author: human:maxrg
    last_modified: 2026-07-31
---

A place that has to be staffed: a ward, a theatre, a unit, a desk. Table
`workstations`.

# Schema

| Column | Meaning |
|---|---|
| `name` | What people on the ward call it |
| `available` | Whether it is planned at all; toggled by the `enable`/`disable` endpoints |
| `active_shift_ids` | UUID **array** of the shifts that operate here |
| `priority` | `high`, `medium` or `low` |
| `min_employees` / `max_employees` | Headcount band per shift; `max` blank means no limit |
| `tenant_id` | Isolation boundary |

Two associated tables:

| Table | Meaning |
|---|---|
| `workstation_required_capabilities` | The qualifications needed — **all** of them |
| `workstation_unavailabilities` | Date ranges when the workstation is closed |

`available` and `workstation_unavailabilities` answer different questions:
`available: false` removes the workstation from planning indefinitely without
deleting it and losing its history; an unavailability closes it for a bounded
range (refurbishment, seasonal shutdown).

# Required capabilities are conjunctive

Listing four required capabilities means only staff holding **all four** may ever
be assigned here. That is frequently nobody. When a workstation stubbornly comes
back understaffed, this is the first thing to check — before priority, before
headcount, before absences. See
[Infeasibility playbook](/solver/infeasibility-playbook.md).

# Priority decides who loses out

Priority weights the coverage reward, so it only bites when there are not enough
people to go round:

| Value | Use for | Default weight |
|---|---|---|
| `high` | Must be staffed — emergency, intensive care, theatres in use | 10000 |
| `medium` | Normal wards | 1000 |
| `low` | Desirable but postponable — outpatient desks, day clinics | 100 |

If everything is `high`, priority tells the solver nothing and shortage is spread
evenly instead of being concentrated away from critical posts. The **gaps**
between the three weights carry the meaning, not their absolute size — see
[Planner settings reference](/solver/planner-settings-reference.md).

# Related

* What people need to work here: [Capability](/concepts/capability.md)
* What runs here: [Shift](/concepts/shift.md)
* Coverage results: [Confirmed shift plan](/concepts/confirmed-shift-plan.md)
* Setting one up: [Ward setup](/guide/ward-setup.md)
