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
   (ChatOpenAI + ToolNode)          └── get/update_planner_settings
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
- **`mcp_server.py`** — a separate MCP server, generated directly from
  `../api/openapi.yaml` via FastMCP's `FastMCP.from_openapi()`. Unlike
  `tools/backend_api.py`'s hand-picked tools for the chat agent, this exposes
  the whole backend REST API as MCP tools (one per operation) for any MCP
  client — Claude Code, Claude Desktop, etc.
- **`cli.py`** — `shift-agent chat` for local testing without a browser,
  `shift-agent api` to start the server, `shift-agent mcp` to start the MCP
  server.

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
make mcp    # start the MCP server (stdio transport)
```

### MCP server

`shift-agent mcp` starts an MCP server built straight from `../api/openapi.yaml`
— every backend operation becomes an MCP tool automatically, so it stays in
sync with the spec without hand-written wrappers. Point an MCP client at it:

```bash
uv run shift-agent mcp                              # stdio (default)
uv run shift-agent mcp --transport http --port 8900  # streamable HTTP
```

To register it with Claude Code (stdio transport):

```bash
claude mcp add shift-backend -- uv --directory /path/to/backend/agent run shift-agent mcp
```

Over HTTP transport, the server is multi-tenant: each connecting MCP client
authenticates against Keycloak itself (see "Multi-tenant auth" below), and
its own token is what gets forwarded to the backend — set `MCP_OAUTH_CLIENT_ID`
/ `MCP_OAUTH_CLIENT_SECRET` to turn this on; unset, the server runs with no
auth of its own and falls back to the single-token behavior described below
(fine for stdio / local use). See `.env.example`.

```bash
make mcp-http    # start the HTTP MCP server on :8900
make mcp-token   # fetch an access token (client credentials grant) to curl it with
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

Token resolution for every backend call lives in `shift_agent/auth.py`, in
priority order:

1. **The current request's own token**, as authenticated by `mcp_server.py`'s
   `MultiAuth` — this is the real per-tenant path. Each MCP client goes
   through Keycloak's OAuth2 authorization code grant + Dynamic Client
   Registration (`OIDCProxy`, using `MCP_OAUTH_CLIENT_ID`/`SECRET` as the
   upstream client), or presents an already-obtained Keycloak bearer token
   directly (`JWTVerifier`, skipping the interactive flow — `make mcp-token`
   fetches one via the client credentials grant). Either way, FastMCP exposes
   that request's token via `get_access_token()`, and `auth.py` forwards it
   as-is — nothing is cached, since FastMCP already scopes it per-request.
   Only applies over HTTP transport with `MCP_OAUTH_CLIENT_ID`/`SECRET` set.
2. **`BACKEND_ACCESS_TOKEN`** — a single static token, used when (1) doesn't
   apply (stdio transport, or no server auth configured): fine for local
   testing or a single-tenant deployment.

The LangGraph chat agent's tools (`tools/backend_api.py`) go through the same
`auth.py`, but since they're not driven by an authenticated MCP request, they
only ever see (1) as empty and fall through to (2) — a single server-side
identity (or none, in dev mode) for every chat user. Making the *chat* agent
itself multi-tenant would mean the website forwarding the signed-in user's
own token with each `/chat` request and `server.py` threading it through
per-request instead of relying on `auth.py`'s fallback — intentionally left
as an exercise rather than guessed at here.
