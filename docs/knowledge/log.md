# Bundle Update Log

## 2026-08-23

* **Change**: The chat assistant can now read an existing roster out of an
  attached PDF, CSV or XLSX file and turn it into shift assignments, after
  showing the user what it read and being told to go ahead. New agent modules
  `agent/shift_agent/agent/documents.py` (parsing) and `roster.py` (the three
  tools and the per-session upload store); new endpoint
  `POST /api/v1/chat/upload` on the agent, and `POST /shift-assignments/import`
  on the backend.
* **Creation**: Added [Importing a roster](/guide/importing-a-roster.md) — what
  a readable file looks like, what to check in the assistant's summary before
  agreeing, and what the import deliberately does not do.
* **Revision**: [Using the assistant](/guide/using-the-assistant.md) — "read a
  file for me" as a fifth kind of request.
* **Revision**: [Agent and MCP service](/architecture/agent-and-mcp-service.md) —
  the second local capability, and why the grid is expanded in Python while only
  the layout comes from the model.
* **Revision**: [Shift assignment](/concepts/shift-assignment.md) and
  [REST API](/interfaces/rest-api.md) — the bulk import endpoint, its name-based
  matching and its `dry_run` mode.

## 2026-08-01

* **Change**: The chat agent now reads this bundle. `agent/shift_agent/agent/knowledge.py`
  loads it at startup and exposes `searchKnowledge`, `readKnowledgeDoc` and
  `listKnowledgeTopics`, so the assistant answers "how does X work" questions
  from these documents instead of from the model's own recollection. The bundle
  root is `SHIFT_AGENT_KNOWLEDGE_PATH` / `--knowledge-path`, defaulting to
  `docs/knowledge`, and `deploy/Dockerfile.agent` copies it to `/docs/knowledge`
  in the image.
* **Revision**: [Agent and MCP service](/architecture/agent-and-mcp-service.md) —
  documented the knowledge tools, their retrieval model and the path resolution;
  corrected "no tools of its own", which now holds only for backend state.
* **Revision**: [Using the assistant](/guide/using-the-assistant.md) — added
  "explain something" as a fourth kind of request, and the corresponding limit:
  its explanations are only as current as this bundle.
* **Note**: This bundle is now a runtime dependency of the agent image, not only
  reference material. A document added here reaches the assistant on the next
  image build; nothing in the agent needs changing.

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
