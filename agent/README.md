# Shift Agent

A LangGraph-based conversational agent that helps signed-in users navigate the
Shift Planner web app and change its configuration by talking to it, instead
of clicking through menus.

The agent has **no backend tools of its own**. It discovers and calls them on
the **MCP server** over HTTP (`MCP_SERVER_URL`, default
`http://mcp:8900/mcp` — the `mcp` service in `deploy/docker-compose.yml`),
which is generated from the OpenAPI spec. Any operation added to the backend
becomes available to the agent without a line of agent code.

## Architecture

Two sub-packages, one process each, and only a token crossing between them:

```
Website chat widget · scheduler page
        │  POST /api/v1/chat  { message, session_id }
        │  POST /api/v1/plan/validate  { result_id }
        │  Authorization: Bearer <keycloak-token>
        │  X-Access-Token: <token>  (set by APISIX in front of this route)
        ▼
┌─ shift_agent/agent ─────────────────────────────────────────────┐
│ Flask API (server.py) ─── Keycloak token verification (auth.py) │
│        │  puts the request's token in a contextvar (auth.py)    │
│        ▼                                                        │
│ LangGraph agent (graph.py)                                      │
│    agent ⇄ tools loop  ──┬────────► knowledge tools             │
│    (Ollama / OpenAI +    │          (knowledge.py, in-process,  │
│     ToolNode)            │           reads docs/knowledge)      │
│                          └────────► MCP client (client.py)      │
│                                              │                  │
└──────────────────────────────────────────────┼──────────────────┘
                                               │ streamable HTTP
                                               │ Authorization: Bearer
                                               │ <that same token>
┌─ shift_agent/mcp ────────────────────────────▼──────────────────┐
│ MCP server (server.py)  ─── token resolution (auth.py)          │
└──────────────────────────────────────────────┼──────────────────┘
        │                                      ▼
        │                        Rust backend REST API (../src)
        ▼
   { reply, ui_action }
```

### `shift_agent/agent` — the chat agent

- **`graph.py`** — the agent itself: a ReAct loop (`agent` node calls the LLM,
  `tools` node runs whatever it asked for via the MCP client, loop until the
  model answers in plain text). Conversation history is kept in memory per
  `session_id` via LangGraph's `MemorySaver` checkpointer.

- **`knowledge.py`** — the agent's only tools of its own: `searchKnowledge`,
  `readKnowledgeDoc` and `listKnowledgeTopics` over the Open Knowledge Format
  bundle in [`../docs/knowledge`](../docs/knowledge). The MCP tools report
  *state*; these explain *the product* — how a ward manager does something, what
  a domain concept means, how the services fit together, why the solver decided
  what it did. Search is lexical (TF-IDF over frontmatter and body, with crude
  stemming) — no embeddings, no index to build, nothing to keep in sync. See
  [Knowledge base](#knowledge-base) below for the path configuration.

- **`client.py`** — lists the MCP server's tools at startup and wraps them as
  LangChain `StructuredTool` objects the agent can call. Each call opens its
  own short-lived session carrying the current user's token; one long-lived
  session can't work, since its headers are fixed at connect time while the
  graph is a process-wide singleton shared by every user.

- **`validation.py`** — checking a *proposed* plan against the rules it was
  solved under: `POST /api/v1/plan/validate` behind the scheduler page's **Verify
  Plan** button, and `validateOptimizedPlan` for the chat. It fetches the stored
  result (`getOptimizedShift`) and the rules for its period (`preparePlan` — the
  same payload the optimizer gets) through MCP, then re-derives every hard
  constraint of the CP-SAT model in Python: one shift a day, qualifications,
  absences, minimum rest, recovery days, consecutive and weekly day limits,
  staffing maximums. Soft constraints the solver may trade away — staffing
  minimums, preferred days off, hours targets — come back as warnings. **The
  counting never goes near the model**; only the finished report does, in one
  plain LLM call that writes it up. Two checks of an unchanged plan therefore
  cannot disagree about what is wrong with it.

- **`server.py`** — the HTTP surface the website talks to. Validates the
  caller's token against Keycloak's JWKS endpoint, then puts it in `auth.py`'s
  per-request contextvar for the duration of the agent call.

- **`auth.py`** — Keycloak verification for `POST /api/v1/chat`, plus the
  contextvar holding the token `client.py` presents to the MCP server.

### `shift_agent/mcp` — the MCP server

- **`server.py`** — generated directly from `../api/openapi.yaml` via FastMCP's
  `FastMCP.from_openapi()`: the whole backend REST API as MCP tools, one per
  operation, for the chat agent and external MCP clients (Claude Code, Claude
  Desktop) alike. Plus `navigate`, the one tool with no REST equivalent — it
  targets the browser, and `agent/server.py` turns it into a `ui_action`.

- **`auth.py`** — decides which access token the server's backend calls carry:
  whatever the caller presented, else `BACKEND_ACCESS_TOKEN`.

### Shared

- **`config.py`** — all configuration from environment variables, including
  LLM provider selection (Ollama local, Ollama.com cloud, OpenAI).

- **`cli.py`** — `shift-agent chat` for local testing, `shift-agent api` to
  start the chat server, `shift-agent mcp` to start the MCP server,
  `shift-agent knowledge` to inspect the documentation bundle,
  `shift-agent validate` to check a plan from the terminal.

## Knowledge base

The agent answers "how does X work" questions from the OKF bundle in
`backend/docs/knowledge` — ~50 Markdown documents, each with YAML frontmatter
naming its title, type, description and tags. It is loaded once when the graph
is built and held in memory; the documents ship with the image and are never
re-read.

The bundle root is fixed **at startup**, in this order:

1. `--knowledge-path` on `shift-agent api` / `shift-agent chat`
2. `SHIFT_AGENT_KNOWLEDGE_PATH`
3. `backend/docs/knowledge`, resolved relative to the installed package — which
   inside `deploy/Dockerfile.agent` lands on `/docs/knowledge`, where the image
   copies the bundle.

A path with no documents in it is not fatal: the three tools are simply not
bound, the agent keeps its MCP tools, and startup logs a warning. Note that
`MCP_TOOLS` does not apply here — that allowlist only trims MCP tools.

Check what the running agent can see, locally or in the container:

```bash
# Every document the agent has, and where they came from
shift-agent knowledge
docker compose exec agent shift-agent knowledge

# What searchKnowledge would return for a question
shift-agent knowledge "why is the plan infeasible"

# A different bundle
shift-agent api --knowledge-path /srv/my-knowledge
```

## LLM Providers

The agent supports three LLM backends, configured via `SHIFT_AGENT_LLM_PROVIDER`:

| Provider | Env Value | Model Examples | API Key |
|----------|-----------|----------------|---------|
| Ollama (local) | `ollama` | `llama3.2`, `qwen2.5`, `mistral` | Not needed |
| Ollama.com | `ollama-com` | `llama3.2-70b`, `qwen2.5-72b-instruct` | `OLLAMA_COM_API_KEY` |
| OpenAI | `openai` | `gpt-4o`, `gpt-4o-mini` | `OPENAI_API_KEY` |

## Setup

```bash
make install          # installs uv if missing, then `uv sync`
cp .env.example .env  # configure your LLM provider and model
```

### Quick start with local Ollama

```bash
# 1. Start Ollama (if not running)
ollama serve

# 2. Pull a model
ollama pull llama3.2

# 3. Configure .env
#    SHIFT_AGENT_LLM_PROVIDER=ollama
#    SHIFT_AGENT_MODEL=llama3.2
#    OLLAMA_BASE_URL=http://localhost:11434

# 4. Run the agent
make chat
```

### Using ollama.com cloud

```bash
# Configure .env
# SHIFT_AGENT_LLM_PROVIDER=ollama-com
# SHIFT_AGENT_MODEL=llama3.2-70b
# OLLAMA_COM_API_KEY=ollama_sk_...
```

### Using OpenAI

```bash
# Configure .env
# SHIFT_AGENT_LLM_PROVIDER=openai
# SHIFT_AGENT_MODEL=gpt-4o
# OPENAI_API_KEY=sk-...
```

## Running

```bash
make mcp-http  # start the MCP server on :8900 — the agent needs it
make chat      # talk to the agent in the terminal
make api       # start the HTTP API on :8899
make mcp       # start the MCP server on stdio instead (for Claude Code etc.)
```

Running the agent outside Docker, point it at your local MCP server:
`MCP_SERVER_URL=http://localhost:8900/mcp` (the default targets the `mcp`
Docker service). If it isn't up, the first chat request answers 503 and the
next one retries.

`MCP_TOOLS` narrows what the model sees to a comma-separated allowlist of tool
names — worth setting for small local models, which pick badly from all ~70
backend operations. Unset means everything.

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

### Chat API with Keycloak auth

When `KEYCLOAK_JWKS_URL` (or `KEYCLOAK_REALM_URL`) is configured, every
`POST /api/v1/chat` request must include a valid Keycloak bearer token:

```bash
# Get a token from Keycloak
TOKEN=$(curl -s -X POST "$KEYCLOAK_REALM_URL/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=shift-agent" \
  -d "client_secret=..." | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# Chat with the agent
curl -X POST http://localhost:8899/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message": "take me to the planner settings page"}'
# {"session_id": "default", "reply": "...", "ui_action": {"action": "navigate", "path": "/planner-settings"}}

curl -X POST http://localhost:8899/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message": "what are the current optimizer settings?"}'
```

### Checking a plan

```bash
curl -X POST http://localhost:8899/api/v1/plan/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"result_id": "0f2c…"}'
# { "verdict": "issues", "error_count": 0, "warning_count": 4,
#   "findings": [ … ], "headline": "…", "summary": "…" }
```

`verdict` is `valid` (nothing found), `issues` (soft warnings only) or `invalid`
(a hard rule is broken). Each finding collapses every breach of one rule into a
count plus up to five named examples. Same thing from the terminal:

```bash
uv run shift-agent validate <result-id>          # readable summary
uv run shift-agent validate <result-id> --json   # the raw report
```

In dev mode (no Keycloak configured), the endpoint accepts requests without
authentication.

## Extending

- **New backend endpoint**: add it to `../api/openapi.yaml` and the Rust
  backend. The MCP server picks it up automatically via
  `FastMCP.from_openapi()`, and the agent discovers it the next time it
  connects. No agent code changes needed (add the name to `MCP_TOOLS` if
  you've set an allowlist).
- **New navigable page**: add it to `mcp/server.py`'s `KNOWN_PAGES` and to
  `ui/src/app/app.routes.ts`.
- **New rule checked in a plan**: add a `_check_*` method to `_Validator` in
  `agent/validation.py` and call it from `run()`, mirroring the constraint it
  comes from in `../planner/shift_planner/optimizer.py`.
- **Persistent conversation history**: swap `MemorySaver` in `agent/graph.py`
  for `langgraph.checkpoint.sqlite.SqliteSaver` or
  `langgraph.checkpoint.postgres.PostgresSaver`.
- **Streaming replies**: use `graph.astream(...)` instead of
  `graph.ainvoke(...)` in `agent/server.py`, turned into a chunked or
  Server-Sent-Events HTTP response.

## Multi-tenant auth

One token travels the whole way: the user's. The chat request carries it in,
the agent presents it to the MCP server, and the MCP server presents it to the
backend — so every call runs as the signed-in user, not as the service.

1. **Into the agent** — `agent/server.py` takes the token off the chat request
   (`X-Access-Token`, set by APISIX's openid-connect plugin on the route in
   front of `POST /api/v1/chat`; else the `Authorization` bearer token, for
   local testing), verifies it against Keycloak's JWKS, and puts it in a
   contextvar for the duration of that `graph.invoke()` call.
2. **Agent → MCP server** — `agent/client.py` reads it back out on every tool
   call and sends it as `Authorization: Bearer`.
3. **MCP server → backend** — `mcp/auth.py` resolves the token the caller
   presented and attaches it to the backend call. With
   `MCP_OAUTH_CLIENT_ID`/`SECRET` set, `MultiAuth` verifies it first: external
   MCP clients can go through Keycloak's OAuth2 authorization code grant +
   Dynamic Client Registration (`OIDCProxy`), or present an already-obtained
   Keycloak bearer token directly (`JWTVerifier` — `make mcp-token` fetches one
   via the client credentials grant). Unset (as in `deploy/docker-compose.yml`,
   which needs HTTPS for the OIDC issuer), the server verifies nothing itself
   and forwards the caller's header as-is — APISIX and the backend still
   validate it.
4. **`BACKEND_ACCESS_TOKEN`** — a single static token, used wherever no
   per-request token is available: `shift-agent chat` in the terminal, stdio
   transport, single-tenant deployments.
