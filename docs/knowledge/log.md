# Bundle Update Log

## 2026-07-31

* **Creation**: Established the bundle root [index](/index.md) and this log,
  targeting OKF v0.2.
* **Creation**: Added [Concepts](/concepts/index.md) — fourteen domain entities
  extracted from `docs/domain-model.md`, `src/schema.rs` and `migrations/`.
* **Creation**: Added [Architecture](/architecture/index.md) — five service
  concepts, two data stores, the [planning pipeline](/architecture/planning-pipeline.md),
  and three design decisions.
* **Creation**: Added [Interfaces](/interfaces/index.md) — REST, optimizer
  contract, NATS subjects, MCP tool surface, XLSX import/export.
* **Creation**: Added [Solver](/solver/index.md) — constraint model, objective
  terms, settings reference and the infeasibility playbook.
* **Creation**: Added [User Guide](/guide/index.md) — seven task guides derived
  from `docs/guide/`.
* **Creation**: Added [Operations](/operations/index.md) — local development,
  configuration, database, deployment and the production checklist.
* **Note**: [Shift wish](/concepts/shift-wish.md) and its `wish_weight` setting
  (migrations 23 and 24) are documented here from the schema and
  `planner/shift_planner/models.py`; the prose `docs/planner.md` settings table
  does not yet list `wish_weight`.
