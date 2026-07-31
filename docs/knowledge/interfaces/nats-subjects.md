---
type: API Surface
title: NATS Subjects
description: The two subjects carrying optimization work, the SCHEDULING stream, the result subscriber, and the degraded no-JetStream path.
resource: src/services/optimizer.rs
tags: [interfaces, nats, jetstream, messaging]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: src/services/optimizer.rs
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: docs/backend.md
    author: human:maxrg
    last_modified: 2026-07-31
---

Two subjects, one stream. Constants live in `src/services/optimizer.rs`:

```rust
pub const NATS_SCHEDULING_SUBJECT: &str = "scheduling";
pub const NATS_RESULTS_SUBJECT: &str = "scheduling.results";
```

| Subject | Direction | Payload |
|---|---|---|
| `scheduling` | Backend → optimizer | The `TaskDTO` / `SchedulingInput` — see [Optimizer contract](/interfaces/optimizer-contract.md) |
| `scheduling.results` | Optimizer → backend | The solver output |

Stream: **`SCHEDULING`**, created over subject `scheduling` by `broker::connect`.
Default NATS ports: 4222 client, 8222 monitoring.

# Both ends

**Publish.** `POST /api/v1/planner/plan` inserts a `planning_tasks` row as
`scheduled`, publishes the payload, and returns `{ task_id }` immediately.

**Consume.** The optimizer's `nats_handler.py` subscribes, solves, and publishes
on `scheduling.results`. Started with `cd planner && make nats`.

**Subscribe back.** `optimizer::start_result_subscriber` runs for the backend's
process lifetime, consuming `scheduling.results`, storing each result in
`optimized_shift_results` and advancing the matching `planning_tasks` row to
`done` (with a `result_id`) or `error` (with a message).

# The degraded path

`broker::connect` attempts stream creation. If it fails, the connection is still
returned with `JetStreamStatus::Unavailable` and the backend falls back to **plain
publish** — no durability, but the optimizer's HTTP mode can still serve the work.

If NATS is unreachable entirely, `POST /planner/plan` fails with **500**; the rest
of the API is unaffected. A deployment where browsing and editing work but
calculating does not is a broker problem.

# Triage

| Symptom | Where to look |
|---|---|
| `POST /planner/plan` returns 500 | NATS unreachable — check `broker.host` / `broker.port` |
| Task stays `running` forever | Optimizer not consuming; `make nats` not started, or the container is down |
| Tasks flip to `failed` on restart | The three-hour stale-task reaper — the run never completed |
| Results never stored | The backend's result subscriber died, or the optimizer is publishing to the wrong subject |

# Related

* [Planning task](/concepts/planning-task.md) - the lifecycle these subjects drive
* [Data stores](/architecture/data-stores.md) - why a broker at all
* [Planning pipeline](/architecture/planning-pipeline.md)
