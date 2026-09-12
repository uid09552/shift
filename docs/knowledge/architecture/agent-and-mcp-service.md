---
type: Service
title: Agent and MCP Service
description: The LangGraph chat agent, its knowledge tools, and the FastMCP server generated from the OpenAPI spec — one image, two commands, and the user's token carried end to end.
resource: agent/shift_agent
tags: [architecture, agent, mcp, langgraph, llm, knowledge]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-08-01T00:00:00Z
sources:
  - resource: docs/agent.md
    author: human:maxrg
    last_modified: 2026-08-01
  - resource: agent/shift_agent/mcp/server.py
    author: human:maxrg
    last_modified: 2026-07-26
  - resource: agent/shift_agent/agent/graph.py
    author: human:maxrg
    last_modified: 2026-08-01
  - resource: agent/shift_agent/agent/knowledge.py
    author: human:maxrg
    last_modified: 2026-08-01
---

`agent/` holds a LangGraph chat agent that lets signed-in users drive the app by
talking to it, and the MCP server it calls to get anything done.

**The agent has no backend tools of its own.** Everything that reads or writes
system state comes from the MCP server, generated from `api/openapi.yaml` at
startup — see [Spec-driven tool surface](/architecture/spec-driven-tool-surface.md).

Its main local capability is *this bundle*: three read-only tools over
`docs/knowledge`, so questions about how the product works are answered from
written documentation rather than from the model's own recollection. State comes
from the API; explanation comes from here.

Two more local capabilities follow the same rule, for the same reason — the bulk
data stays out of the model, and only the judgement goes in:

* the **roster upload**, reading a shift plan out of a file the user attached. Its
  writes still go through MCP; the local part exists because the file's *grid*
  must not pass through the model, only the layout the model declares for it.
* the **plan check** (`validation.py`), re-deriving every rule a proposed plan was
  solved under and counting what it breaks. The model explains the findings; it
  does not find them.
* the **plan repair** (`repair.py`), putting right what the check found. Every
  move is tested against the same re-derived rules before it is made; the model's
  only job is turning the planner's sentence ("Anna is off sick on the 12th")
  into directives, which are then checked like any other move.

```mermaid
flowchart TB
    W["Chat widget · Scheduler page<br/>POST /api/v1/chat<br/>POST /api/v1/chat/upload<br/>POST /api/v1/plan/validate<br/>POST /api/v1/plan/fix"] --> S["agent/server.py<br/>Flask + Keycloak verification"]
    S --> G["agent/graph.py<br/>ReAct loop, MemorySaver"]
    G <--> K["agent/knowledge.py<br/>this bundle, in-process"]
    G <--> D["agent/roster.py<br/>uploaded grid, per session"]
    G <--> V["agent/validation.py<br/>rules re-derived, counted"]
    G <--> P["agent/repair.py<br/>moves checked against the same rules"]
    D --> C
    V --> C
    P --> C
    G <--> C["agent/client.py<br/>MCP client"]
    C -->|"streamable HTTP<br/>Authorization: Bearer"| M["mcp/server.py<br/>FastMCP.from_openapi()"]
    M --> B["Rust backend REST API"]
    S --> R["{ reply, ui_action }"]
```

# shift_agent/agent — the chat agent

| File | Role |
|---|---|
| `graph.py` | The ReAct loop: the `agent` node calls the LLM, the `tools` node runs what it asked for, repeat until a plain-text answer. History per `session_id` in LangGraph's in-memory `MemorySaver`. |
| `client.py` | Lists the MCP server's tools at startup and wraps each as a LangChain `StructuredTool`. |
| `knowledge.py` | The agent's own tools over this bundle — `searchKnowledge`, `readKnowledgeDoc`, `listKnowledgeTopics`. |
| `documents.py` | Reduces an uploaded PDF/CSV/XLSX to sheets of cell strings. Interprets nothing. |
| `roster.py` | `previewRosterUpload` / `interpretRosterUpload` / `applyRosterUpload`, over a per-session store of uploaded grids. |
| `validation.py` | `validateOptimizedPlan`, and the `POST /plan/validate` endpoint behind the scheduler's **Verify Plan** button. Checks a proposed plan against the rules; no LLM in the checking. |
| `repair.py` | `repairOptimizedPlan`, and the `POST /plan/fix` endpoint behind the scheduler's **Fix Plan** button. Moves the plan into shape and saves it; no LLM in the moving. |
| `server.py` | HTTP surface. Verifies the caller's token against Keycloak's JWKS, then stores it in a contextvar for the duration of the call. |
| `auth.py` | Keycloak verification plus the contextvar holding the token. |

The roster tools follow the same rule the rest of the agent does. The model
supplies only a *layout* — which column holds the names, which row the dates,
which month, which codes mean a day off — and `roster.py` expands that into the
hundreds of assignments the grid implies, deterministically, in Python. Those go
to `POST /shift-assignments/import` through the MCP client, first with `dry_run`
so the agent can show its reading and ask, then for real once the user agrees.
See [Importing a roster](/guide/importing-a-roster.md) for the user's view and
[Shift assignment](/concepts/shift-assignment.md) for what gets created.

`validation.py` fetches two things through MCP — the stored result
(`getOptimizedShift`) and the rules for its period (`preparePlan`, the same
payload the optimizer was handed) — and re-derives every hard constraint of the
CP-SAT model from them in Python: one shift a day, qualifications, absences,
minimum rest, recovery days, consecutive and weekly day limits, staffing
maximums. The soft ones the solver may trade away — staffing minimums, preferred
days off, hours targets — come back as warnings rather than breaches. Only then
is the finished report handed to a plain LLM call (no tools, no history) to be
written up, so a check run twice on an unchanged plan cannot disagree with
itself. The same code serves the chat tool and the button.

`repair.py` starts from the same two payloads and the same check, then makes one
pass over the plan: a row breaking a hard rule is moved to a place the solver
could have chosen (same shift, another workstation, before another shift) or
removed when there is none, and a second pass fills what is below its minimum
from whoever is free, qualified and has the fewest hours. Because removing an
assignment can never break a hard rule, one pass leaves none behind. The
alternative strategy hands the period back to CP-SAT through the MCP server's
`optimizeSchedule` tool with the planner's pinned rows as `locked_assignments`.
Either way the result goes back through `updateOptimizedShift` and is re-checked
by `validation.validate`, so the report after a repair is produced by the same
counting as the one before it.

One design point worth understanding: `client.py` opens a **fresh short-lived MCP
session per tool call**. A long-lived session would fix its headers at connect
time, but the graph is a process-wide singleton shared by every user — so the
session must be created per call to carry the right user's token.

# shift_agent/mcp — the MCP server

`server.py` builds the tool surface with `FastMCP.from_openapi()`. The one
hand-written tool is `navigate`, which has no REST equivalent: it targets the
browser, and `agent/server.py` turns it into a `ui_action` in the chat response.
Navigable pages are listed in `KNOWN_PAGES`.

Usable directly by any MCP client:

```bash
uv run shift-agent mcp                                # stdio
uv run shift-agent mcp --transport http --port 8900   # streamable HTTP
claude mcp add shift-backend -- uv --directory /path/to/backend/agent run shift-agent mcp
```

# LLM providers

Selected with `SHIFT_AGENT_LLM_PROVIDER`:

| Provider | Value | Example models | Key |
|---|---|---|---|
| Ollama (local) | `ollama` | `llama3.2`, `qwen2.5`, `mistral` | — |
| Ollama.com | `ollama-com` | `llama3.2-70b`, `qwen2.5-72b-instruct` | `OLLAMA_COM_API_KEY` |
| OpenAI | `openai` | `gpt-4o`, `gpt-4o-mini` | `OPENAI_API_KEY` |

`MCP_TOOLS` narrows what the model sees to a comma-separated allowlist. Worth
setting for small local models, which choose badly from all ~70 backend
operations. Unset means everything. The knowledge tools are not affected — that
allowlist covers MCP tools only.

# The knowledge tools

`knowledge.py` loads this bundle once when the graph is built and holds it in
memory. Every document's frontmatter (`title`, `type`, `description`, `tags`) is
parsed out and indexed alongside its headings and body.

| Tool | Use |
|---|---|
| `searchKnowledge` | Keyword search; returns the best-matching documents with path, title, description and a snippet. |
| `readKnowledgeDoc` | One document in full, by bundle path — `concepts/shift.md`, with or without the leading `/` used in this bundle's own links. |
| `listKnowledgeTopics` | The whole catalogue: every path, title and description. |

Retrieval is TF-IDF over those fields with crude suffix stemming, not embeddings.
At ~50 curated documents the frontmatter carries the signal, and the inverse
document frequency matters more than the similarity model: "shift" appears in
nearly every document here and must count for almost nothing, or every question
lands on whichever page says it most often.

The bundle root is fixed **at startup**, first match winning:

1. `--knowledge-path` on `shift-agent api` / `shift-agent chat`
2. `SHIFT_AGENT_KNOWLEDGE_PATH`
3. `docs/knowledge` resolved relative to the installed package — inside
   `deploy/Dockerfile.agent` that is `/docs/knowledge`, where the image copies
   the bundle and `docker-compose.yml` pins the variable.

A path with no documents is not fatal: the tools are simply not bound, the agent
keeps its MCP tools, and startup logs a warning. To see what a running agent
actually has:

```bash
shift-agent knowledge                              # list every document
shift-agent knowledge "why is the plan infeasible" # what searchKnowledge returns
docker compose exec agent shift-agent knowledge    # …inside the container
```

# Chat API

```bash
curl -X POST http://localhost:8899/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message": "take me to the planner settings page"}'
```

```json
{
  "session_id": "default",
  "reply": "...",
  "ui_action": {"action": "navigate", "path": "/planner-settings"}
}
```

With no Keycloak configured (`KEYCLOAK_JWKS_URL` / `KEYCLOAK_REALM_URL` unset)
the endpoint accepts unauthenticated requests — development only.

# The token chain

The signed-in user's token travels the whole way, so every call runs as that user
under that user's tenant. The agent has no privileges of its own. Full chain in
[Gateway and identity](/architecture/gateway-and-identity.md).

# Running and extending

```bash
cd agent && make install && cp .env.example .env
make mcp-http     # MCP server on :8900 — start this first
make api          # chat API on :8899
make chat         # or a terminal session
```

Outside Docker set `MCP_SERVER_URL=http://localhost:8900/mcp`; the default targets
the `mcp` Compose service. If the MCP server isn't up the first chat request
returns 503 and the next retries.

| Goal | What to do |
|---|---|
| New backend capability | Add it to `api/openapi.yaml` and the backend; the MCP server picks it up automatically |
| New navigable page | Add it to `KNOWN_PAGES` **and** `ui/src/app/app.routes.ts` |
| Something the assistant explains wrongly | Fix or add the document here in `docs/knowledge`; nothing in the agent changes |
| Persistent history | Swap `MemorySaver` for `SqliteSaver` or `PostgresSaver` in `graph.py` |
| Streaming replies | Use `graph.astream(...)` instead of `graph.ainvoke(...)` |

`mcp` is not a separate image: Compose runs the `agent` image with a different
command.
