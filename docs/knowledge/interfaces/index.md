---
type: Directory
title: Interfaces
description: Every contract the system exposes — REST API, optimizer JSON, NATS subjects, MCP tools and spreadsheet import/export.
tags: [interfaces, api, contracts]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
---

Five surfaces, four of them generated from or checked against a single source of
truth.

* [REST API](/interfaces/rest-api.md) - the backend's HTTP surface, ~66 operations. `api/openapi.yaml` is the contract; this is the map.
* [Optimizer contract](/interfaces/optimizer-contract.md) - the JSON the backend sends the solver and what comes back. Defined by Pydantic models in `planner/shift_planner/models.py`.
* [NATS subjects](/interfaces/nats-subjects.md) - `scheduling` and `scheduling.results`, the stream, and the degraded no-JetStream path.
* [MCP tool surface](/interfaces/mcp-tool-surface.md) - one tool per OpenAPI operation, plus `navigate`. Transports, allowlisting and auth.
* [XLSX import and export](/interfaces/xlsx-import-export.md) - template/import pairs for bulk data entry, and calendar exports.

# Which one to reach for

| Task | Surface |
|---|---|
| Any read or write of ward data | [REST API](/interfaces/rest-api.md) |
| Understanding what the solver was told | `POST /planner/prepare`, then [Optimizer contract](/interfaces/optimizer-contract.md) |
| Debugging a plan that never completes | [NATS subjects](/interfaces/nats-subjects.md) |
| Driving the app from an LLM or MCP client | [MCP tool surface](/interfaces/mcp-tool-surface.md) |
| Loading a ward from a spreadsheet | [XLSX import and export](/interfaces/xlsx-import-export.md) |

Nothing writes to PostgreSQL except the backend, so every surface above except
the optimizer contract ultimately resolves to the REST API.
