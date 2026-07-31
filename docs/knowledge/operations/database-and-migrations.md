---
type: Runbook
title: Database and Migrations
description: PostgreSQL 17 through Diesel — the 25 migrations and what each added, the Diesel workflow, the table inventory, and backups.
resource: migrations
tags: [operations, database, diesel, migrations, postgresql]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/database.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: migrations
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: src/schema.rs
    author: human:maxrg
    last_modified: 2026-07-31
---

PostgreSQL 17 through Diesel 2.1 with an r2d2 pool. Connection defaults and the
store's role are in [Data stores](/architecture/data-stores.md).

# Migrations are embedded

They live in `migrations/`, one directory per step with `up.sql` and `down.sql`,
are **compiled into the binary**, and are applied at startup. There is no separate
migrate command in normal operation — starting a newer backend against an older
database migrates it.

| # | Migration | What it added |
|---|---|---|
| 00 | `create_initial_tables` | employees, shifts, capabilities, workstations, link tables |
| 01 | `add_shift_weekday_times` | per-weekday shift times |
| 02 | `workstation_active_shift_ids_array` | shifts operating at a workstation |
| 03 | `add_shift_short_name_and_color` | calendar presentation |
| 04 | `add_employee_shift_assignments` | fixed pre-assignments |
| 05 | `add_employee_monthly_working_hours` | contracted monthly target |
| 06 | `add_confirmed_shift_plans` | the approved schedule |
| 07 | `add_optimized_shift_results` | raw solver output as JSONB |
| 08 | `add_workstation_to_confirmed_shift_plans` | plans record *where*, not just *when* |
| 09 | `add_analysis_indexes` | indexes for the reporting queries |
| 10 | `add_shift_weekday_employee_limits` | per-weekday min/max staffing |
| 11 | `add_shift_order` | display ordering |
| 12 | `add_workstation_priority` | high / medium / low |
| 13 | `nullable_shift_in_plans` | plan rows that record absence |
| 14 | `add_planning_tasks` | async optimization task tracking |
| 15 | `add_shift_free_days_after_shift` | mandatory rest after a shift |
| 16 | `add_workstation_employee_limits` | per-workstation headcount band |
| 17 | `add_workstation_unavailabilities` | workstation closure ranges |
| 18 | `add_tenant_id` | multi-tenancy across every table |
| 19 | `widen_absence_type_check` | more absence categories |
| 20 | `add_audit_logs` | audit trail |
| 21 | `add_planner_settings` | per-tenant solver configuration |
| 22 | `paper_algorithm_extensions` | skill levels, soft preferences, weekly hour bands, fatigue weights |
| 23 | `add_shift_wishes` | employee shift wishes |
| 24 | `add_wish_weight` | per-tenant `wish_weight` on `planner_settings` |

# Working with Diesel

`diesel.toml` points the CLI at `src/schema.rs`.

```bash
diesel migration generate <name>   # scaffold up.sql / down.sql
diesel migration run               # apply and regenerate schema.rs
diesel migration redo              # verify down.sql actually reverses it
```

`src/schema.rs` is **generated** — edit migrations, never the schema file. Run
`redo` before committing; a `down.sql` that does not reverse cleanly is only
discovered when someone needs it.

# Tables

**Core entities**

| Table | Key columns |
|---|---|
| `employees` | `name`, `email`, `monthly_working_hours` |
| `capabilities` | `name`, `level`, `skill_group` |
| `shifts` | `name`, `short_name`, `color`, `order` |
| `shift_weekday_times` | `shift_id`, `weekday`, `start_time`, `end_time`, `min_employees`, `max_employees`, `free_days_after_shift` |
| `workstations` | `name`, `available`, `active_shift_ids` (UUID array), `priority`, `min_employees`, `max_employees` |

**Links** — `employee_capabilities` (`employee_id`, `capability_id`),
`employee_available_shifts` (`employee_id`, `shift_id`),
`workstation_required_capabilities` (`workstation_id`, `capability_id`).

**Availability and intent**

| Table | Key columns |
|---|---|
| `unavailabilities` | `employee_id`, `unavailable_date`, `shift_id?`, `is_soft_preference` |
| `workstation_unavailabilities` | `workstation_id`, `unavailable_from`, `unavailable_to` |
| `shift_wishes` | `employee_id`, `shift_id`, `wish_date`; `UNIQUE (employee_id, wish_date)` |

**Planning**

| Table | Key columns |
|---|---|
| `employee_shift_assignments` | `employee_id`, `shift_id`, `date` |
| `confirmed_shift_plans` | `employee_id`, `shift_id?`, `workstation_id?`, `date`, `is_present`, `absence_type?`, `creation_type` |
| `optimized_shift_results` | `result` (JSONB), `creation_date` |
| `planning_tasks` | `status`, `payload` (JSONB), `result_id?`, `error_message?` |

**Operations** — `planner_settings` (one row per tenant, primary key `tenant_id`),
`audit_logs` (`actor?`, `action`, `entity_type?`, `entity_id?`, `changes?`,
`created_at`).

# Tenancy

Every table carries `tenant_id`. Isolation is enforced in the repository layer,
not by a row-level security policy — so anything bypassing the repositories (a
`psql` session, an ad-hoc script, a backup) sees all tenants. Treat direct
database access as privileged. See
[Tenant isolation](/architecture/tenant-isolation.md).

# Backups

`postgres_data` is a named Docker volume. Dump before upgrading:

```bash
docker exec shift_postgres pg_dump -U postgres shift > shift-$(date +%F).sql
```
