# Shift Agent

A LangGraph-based conversational agent that helps signed-in users navigate the
Shift Planner web app and change its configuration by talking to it, instead
of clicking through menus. It is a **skeleton** — a small, real, runnable
agent with a couple of working tools, meant to be extended.

It is a separate service from the Rust backend (`../src`) and the Python
optimizer (`../planner`): it calls the backend's REST API as a client, the
same way the Angular frontend does.

## Architecture

```
Website chat widget
        │  POST /api/v1/chat  { message, session_id }
        ▼
Flask API (server.py)
        │
        ▼
LangGraph agent (graph.py)          ┌── navigate            (picks a frontend route)
   agent ⇄ tools loop  ────────────►├── list_shifts / list_workstations / ...
   (ChatAnthropic + ToolNode)       └── get/update_planner_settings
        │                                    │
        │                                    ▼
        │                          Rust backend REST API (../src)
        ▼
   { reply, ui_action }
```

- **`graph.py`** — the agent itself: a minimal ReAct loop (`agent` node calls
  the model, `tools` node runs whatever it asked for, loop until the model
  answers in plain text). Conversation history is kept in memory per
  `session_id` via LangGraph's `MemorySaver` checkpointer.
- **`tools/navigation.py`** — the `navigate` tool doesn't call anything; it
  resolves a page name to a frontend route (kept in sync with
  `ui/src/app/app.routes.ts`). The Flask layer picks the result back out of
  the tool-call history and returns it as `ui_action`, so the chat widget can
  call `router.navigate(path)`.
- **`tools/backend_api.py`** — the "configure settings" tools. They call the
  Rust backend's REST API directly (see `../api/openapi.yaml`).
- **`server.py`** — the HTTP surface the website talks to.
- **`cli.py`** — `shift-agent chat` for local testing without a browser,
  `shift-agent api` to start the server.

## Setup

```bash
make install          # installs uv if missing, then `uv sync`
cp .env.example .env  # set ANTHROPIC_API_KEY at minimum
```

By default the agent talks to a backend at `http://localhost:8080/api/v1`
running in `--dev-mode` (see the main `Makefile`'s `make serve`) — no auth
token needed. See "Multi-tenant auth" below before deploying this for real.

## Running

```bash
make chat   # talk to the agent in the terminal
make api    # start the HTTP API on :8899
```

```bash
curl -X POST http://localhost:8899/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "take me to the planner settings page"}'
# {"session_id": "default", "reply": "...", "ui_action": {"action": "navigate", "path": "/planner-settings"}}

curl -X POST http://localhost:8899/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "what are the current optimizer settings?"}'
```

## Extending

- **New read/write tool**: add a `@tool`-decorated function to
  `tools/backend_api.py` (or a new file under `tools/`), export it from
  `tools/__init__.py`'s `ALL_TOOLS`, and mention it in `graph.py`'s
  `SYSTEM_PROMPT` if it needs usage guidance. The backend's
  `../api/openapi.yaml` is the source of truth for what's callable.
- **New navigable page**: add it to `KNOWN_PAGES` in `tools/navigation.py`
  and to `ui/src/app/app.routes.ts` if it isn't there yet.
- **Persistent conversation history**: swap `MemorySaver` in `graph.py` for
  `langgraph.checkpoint.sqlite.SqliteSaver` or
  `langgraph.checkpoint.postgres.PostgresSaver` — the rest of the graph is
  unchanged.
- **Streaming replies**: `graph.stream(...)` / `graph.astream(...)` instead
  of `graph.invoke(...)` in `server.py`, turned into a chunked or
  Server-Sent-Events HTTP response.

## Multi-tenant auth

This skeleton's backend tools use a single, server-side `BACKEND_ACCESS_TOKEN`
(or none, in dev mode) for every request — fine for local testing or a
single-tenant deployment. For a real multi-tenant deployment, the website
should forward the signed-in user's own access token with each `/chat`
request (e.g. as an `Authorization` header), and `server.py` should thread it
through to `tools/backend_api.py` per-request instead of reading one token
from `Settings` at startup — that part is intentionally left as an exercise
rather than guessed at here.
