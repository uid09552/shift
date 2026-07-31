---
type: Service
title: Optimizer Service
description: The stateless Python CP-SAT solver — three run modes, no database, JSON in and JSON out.
resource: planner/shift_planner/optimizer.py
tags: [architecture, python, ortools, cp-sat, optimizer]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/planner.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: planner/shift_planner/models.py
    author: human:maxrg
    last_modified: 2026-07-31
---

The Python service in `planner/` turns a description of the ward into a staffing
plan using Google OR-Tools' CP-SAT solver. **It has no database and no state**:
JSON in, JSON out. Everything it knows about the ward arrives in the request.

# Package layout

```
planner/shift_planner/
├── cli.py           Click commands: schedule, api, nats
├── models.py        Pydantic input/output models and validation
├── optimizer.py     the CP-SAT model — constraints and objective
├── server.py        Flask REST API
└── nats_handler.py  NATS JetStream subscriber
```

# Three ways to run it

| Mode | Command | Use |
|---|---|---|
| One-shot | `make schedule` / `uv run shift-planner schedule in.json out.json` | Solve a file with no infrastructure at all |
| REST | `make api` → `POST http://localhost:8888/api/v1/optimize` | Direct request/response testing |
| NATS | `make nats` | **Production.** Tasks on `scheduling`, results on `scheduling.results` |

The NATS mode is how the backend actually talks to it. The REST mode exists
because a synchronous request/response loop is far easier to debug than a
message-passing one, and because the backend falls back to it when JetStream is
unavailable.

Statelessness is what makes all three modes equivalent: the same payload solved
any of the three ways gives the same answer, so a payload captured from
`POST /api/v1/planner/prepare` can be replayed against the file mode offline.

# Contract

Input is `SchedulingInput`, output carries `status`, `objective_value`,
`schedule`, `employee_plans` and `message`. Both are documented in
[Optimizer contract](/interfaces/optimizer-contract.md).

# The model

The constraint formulation and objective are the substance of this service and
live in their own concepts:

* [Constraint model](/solver/constraint-model.md) - the nine hard constraints.
* [Objective terms](/solver/objective-terms.md) - the nine scored goals.
* [Planner settings reference](/solver/planner-settings-reference.md) - every knob.
* [Infeasibility playbook](/solver/infeasibility-playbook.md) - what to do when it returns nothing.

# Deployment

Built from `deploy/Dockerfile.planner`, running as the `planner` Compose service
(container `shift_deploy_planner`). It publishes **no port** — it is reachable
only over NATS. See [Deployment and CI](/operations/deployment-and-ci.md).

# Related

* Who calls it: [Backend service](/architecture/backend-service.md)
* How: [NATS subjects](/interfaces/nats-subjects.md)
* The whole flow: [Planning pipeline](/architecture/planning-pipeline.md)
