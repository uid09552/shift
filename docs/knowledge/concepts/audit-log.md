---
type: Domain Entity
title: Audit Log
description: An append-only record of mutating operations — actor, action, entity and a JSON diff — written by services and read-only over the API.
resource: src/services/audit_log.rs
tags: [domain, audit, compliance]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: migrations/00000000000020_add_audit_logs
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: docs/auth.md
    author: human:maxrg
    last_modified: 2026-07-31
---

Table `audit_logs`, added in migration 20.

# Schema

| Column | Meaning |
|---|---|
| `actor` | Who did it; nullable |
| `action` | What was done, e.g. `planner.optimize` |
| `entity_type` | Which kind of thing; nullable |
| `entity_id` | Which instance; nullable |
| `changes` | JSON diff; nullable |
| `created_at` | When |
| `tenant_id` | Isolation boundary |

# Write path

Entries are recorded from inside the service layer by `audit_log::record` on
mutating operations. There is **no write endpoint** — the API accepts reads only,
so a client cannot forge or suppress an entry.

| Method | Path |
|---|---|
| `GET` | `/api/v1/audit-logs` |

It is tenant-scoped like everything else.

# What it is used for

The UI surfaces the most recent entries as the dashboard's **Recent Activity**
panel. In practice its most frequent use is answering "my changes disappeared" —
`take-as-plan` overwrites the confirmed roster for its whole period, and the
audit trail shows who ran it and when. See
[User troubleshooting](/guide/troubleshooting-playbook.md).

# Related

* Scoping: [Tenant](/concepts/tenant.md)
* What gets overwritten: [Confirmed shift plan](/concepts/confirmed-shift-plan.md)
