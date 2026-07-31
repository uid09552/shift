---
type: Domain Entity
title: Optimized Shift Result
description: A raw solver result stored verbatim as JSONB, so candidate plans can be compared and remain reproducible after the underlying data moves on.
resource: src/models/optimized_shift_result.rs
tags: [domain, optimizer, proposal]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/domain-model.md
    author: human:maxrg
    last_modified: 2026-07-25
---

One solver output, stored as JSONB in `optimized_shift_results`. Columns:
`result` (JSONB), `creation_date`, `tenant_id`.

A result is a **proposal**. It sits to one side and changes nothing until someone
calls `POST /planner/optimized-shifts/{id}/take-as-plan`, which copies it into
[confirmed shift plans](/concepts/confirmed-shift-plan.md). Any number of results
can coexist; a planner can calculate several and compare them.

# Why the payload is kept verbatim

Storing the solver's own JSON rather than normalising it into relational rows
buys two things:

* **Comparability** — several candidate plans over the same period sit side by
  side, each with its own `status` and `objective_value`.
* **Reproducibility** — a result stays exactly what the solver returned even
  after employees, shifts or settings have since changed. A normalised copy would
  drift with the data it references.

The stored shape is the optimizer's output contract: `status`,
`objective_value`, `schedule`, `employee_plans`, `message`. See
[Optimizer contract](/interfaces/optimizer-contract.md).

`PUT /planner/optimized-shifts/{id}` edits a result in place, which is how the
UI's hand-editing of a proposal before adoption is persisted.

# Reading `status`

| Status | Meaning |
|---|---|
| `optimal` | Proven that no better roster exists under the given constraints |
| `feasible` | Valid under every hard constraint, but the time limit expired before optimality could be proven. The normal result on a ward of any size, and a perfectly usable roster |
| `infeasible` | The hard constraints contradict each other; nothing was produced |

`objective_value` is comparable **only** between runs of the same model over the
same period with the same settings.

# Related

* The run that produced it: [Planning task](/concepts/planning-task.md)
* Diagnosing `infeasible`: [Infeasibility playbook](/solver/infeasibility-playbook.md)
* Driving it from the UI: [Creating a schedule](/guide/creating-a-schedule.md)
