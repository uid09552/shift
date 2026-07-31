---
type: Data Store
title: Data Stores
description: PostgreSQL 17 as the single system of record and NATS JetStream as the durable hand-off to the solver, including the degraded no-JetStream path.
resource: deploy/docker-compose.yml
tags: [architecture, postgresql, nats, jetstream]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/database.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: docs/backend.md
    author: human:maxrg
    last_modified: 2026-07-31
---

Two stores, with sharply different roles.

# PostgreSQL 17 — the system of record

Accessed through Diesel 2.1 with an r2d2 connection pool. Only the
[backend service](/architecture/backend-service.md) connects to it.

| Setting | Default |
|---|---|
| Host / Port | `localhost` / `5432` |
| Database | `shift` |
| User / Password | `shift_user` / `shift_password` |

```
postgresql://shift_user:shift_password@localhost:5432/shift
```

The Compose stack starts PostgreSQL with the `postgres`/`postgres` superuser and a
`shift` database; override the backend's credentials to match, or create the
`shift_user` role.

Migrations are embedded in the binary and applied at startup. Schema, tables and
Diesel workflow are in
[Database and migrations](/operations/database-and-migrations.md).

**There is no row-level security policy.** Tenant isolation is enforced entirely
in the repository layer, which means direct database access sees every tenant —
see [Tenant isolation](/architecture/tenant-isolation.md).

`postgres_data` is a named Docker volume. Dump before upgrading:

```bash
docker exec shift_postgres pg_dump -U postgres shift > shift-$(date +%F).sql
```

# NATS JetStream — the durable hand-off

Stream `SCHEDULING` over subject `scheduling`, results on `scheduling.results`.
Ports 4222 (client) and 8222 (monitoring).

A solve can run for minutes — the default time limit alone is 120 seconds — so
the request/response shape of HTTP is a poor fit. JetStream gives a durable queue
that survives a restart on either side, letting `POST /planner/plan` return a task
id immediately.

## The degraded path

`broker::connect` tries to create the stream. If that fails the connection is
**still returned**, flagged `JetStreamStatus::Unavailable`, and the backend falls
back to plain publish. A NATS server without JetStream therefore degrades the
delivery guarantee rather than taking the API down.

Losing NATS entirely is different: `POST /planner/plan` has nowhere to publish and
fails with **500**. Everything else in the API keeps serving. That asymmetry is
worth remembering when triaging — a ward that can browse and edit but cannot
calculate is a broker problem, not a database one.

# Related

* Subjects and payloads: [NATS subjects](/interfaces/nats-subjects.md)
* The flow across both: [Planning pipeline](/architecture/planning-pipeline.md)
* Backups and the volume: [Production checklist](/operations/production-checklist.md)
