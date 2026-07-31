---
type: Domain Entity
title: Planning Task
description: One optimization run — its published payload, its lifecycle from scheduled to done or error, and how stale runs are reaped.
resource: src/services/optimizer.rs
tags: [domain, async, jobs]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/domain-model.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: docs/backend.md
    author: human:maxrg
    last_modified: 2026-07-31
---

One optimization run. Table `planning_tasks`, added in migration 14. The UI calls
these **Jobs**.

# Schema

| Column | Meaning |
|---|---|
| `status` | `scheduled` → `done` \| `error` |
| `payload` | JSONB — exactly what was published to the optimizer |
| `result_id` | Set on success; points at an [optimized shift result](/concepts/optimized-shift-result.md) |
| `error_message` | Set on failure |
| `tenant_id` | Isolation boundary |

# Two vocabularies

Stored states and reported states differ. `GET /planner/plan/{task_id}/status`
translates:

| Stored | Reported |
|---|---|
| `scheduled` | `running` |
| `done` | `completed` |
| `error` | `failed` |

# Lifecycle

1. `POST /planner/plan` loads the tenant's data, inserts the task as `scheduled`,
   publishes the payload on the `scheduling` NATS subject and returns
   `{ task_id }` immediately.
2. The optimizer solves and publishes on `scheduling.results`.
3. The backend's result subscriber stores the result and advances the task to
   `done` with a `result_id`, or to `error` with a message.
4. Clients poll `GET /planner/plan/{task_id}/status`.

`POST /planner/plan` **requires a NATS connection**; without one there is nowhere
to publish and it fails with 500.

# Stale task reaping

Tasks left in `scheduled` for more than three hours are marked failed at server
startup. This is what stops a solver crash or a broker outage from leaving jobs
pinned at `running` forever. It runs only on startup, so a task that hangs while
the server stays up is reaped at the next restart rather than on a timer.

# Related

* The full sequence: [Planning pipeline](/architecture/planning-pipeline.md)
* The payload: [Optimizer contract](/interfaces/optimizer-contract.md)
* Subjects: [NATS subjects](/interfaces/nats-subjects.md)
* Endpoints: `GET /planner/tasks`, `GET`/`DELETE /planner/tasks/{id}` — see [REST API](/interfaces/rest-api.md)
