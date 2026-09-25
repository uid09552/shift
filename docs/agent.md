# Agent & MCP Server

`agent/` holds a LangGraph chat agent that lets signed-in users drive the app by
talking to it, and the MCP server it calls to get anything done.

The agent has **no backend tools of its own**. Everything that touches backend
state comes from the MCP server, which is generated from `api/openapi.yaml` at
startup. Add an endpoint to the spec and the agent can use it — no agent code
changes.

What it does hold locally is documentation: the [knowledge
bundle](#knowledge-base) it reads to explain how the product works, rather than
guessing from whatever the model happens to remember.

```mermaid
flowchart TB
    W["Chat widget<br/>POST /api/v1/chat<br/>POST /api/v1/chat/upload"] --> S["agent/server.py<br/>Flask + Keycloak verification"]
    S --> G["agent/graph.py<br/>ReAct loop, MemorySaver"]
    G <--> K["agent/knowledge.py<br/>OKF bundle, in-process"]
    G <--> D["agent/roster.py<br/>uploaded grid, per session"]
    D --> C
    G <--> C["agent/client.py<br/>MCP client"]
    C -->|"streamable HTTP<br/>Authorization: Bearer"| M["mcp/server.py<br/>FastMCP.from_openapi()"]
    M --> B["Rust backend REST API"]
    S --> R["{ reply, ui_action }"]
```

## `shift_agent/agent` — the chat agent

| File | Role |
|---|---|
| `graph.py` | The ReAct loop: the `agent` node calls the LLM, the `tools` node runs what it asked for, repeat until a plain-text answer. History is kept per `session_id` in LangGraph's in-memory `MemorySaver`, and [capped](#context-window) before each call. |
| `client.py` | Lists the MCP server's tools at startup and wraps each as a LangChain `StructuredTool`. |
| `knowledge.py` | The agent's own tools — `searchKnowledge`, `readKnowledgeDoc`, `listKnowledgeTopics` — over the documentation bundle in `docs/knowledge`. |
| `clock.py` | The agent's other local tool, `currentDateTime` — see [Telling the time](#telling-the-time). |
| `documents.py` | Parses an uploaded PDF/CSV/XLSX into sheets of cell strings. Interprets nothing — see [Roster uploads](#roster-uploads). |
| `roster.py` | `previewRosterUpload`, `interpretRosterUpload`, `applyRosterUpload`, plus the per-session store the uploaded grid lives in. |
| `validation.py` | `validateOptimizedPlan` and the `POST /api/v1/plan/validate` endpoint — checking a proposed plan against the rules it was solved under. See [Plan verification](#plan-verification). |
| `repair.py` | `repairOptimizedPlan` and the `POST /api/v1/plan/fix` endpoint — putting right what the check found, and saving it. See [Plan repair](#plan-repair). |
| `replacement.py` | The `POST /api/v1/roster/replacements` endpoint — who can take an absent person's shift in the confirmed roster. See [Short-notice replacement](#short-notice-replacement). |
| `server.py` | The HTTP surface. Validates the caller's token against Keycloak's JWKS, then stores it in a contextvar for the duration of the agent call. |
| `auth.py` | Keycloak verification plus the contextvar holding the token. |

One design point worth understanding: `client.py` opens a **fresh short-lived
MCP session per tool call**. A single long-lived session would fix its headers
at connect time, but the graph is a process-wide singleton shared by every user
— so the session must be created per call to carry the right user's token.

## `shift_agent/mcp` — the MCP server

`server.py` builds the tool surface with `FastMCP.from_openapi()`: every backend
operation becomes an MCP tool automatically, no hand-written wrappers to drift
out of date. Two tools are written by hand, because they have no REST
equivalent: `navigate`, which targets the browser (`agent/server.py` turns it
into a `ui_action` in the chat response), and `optimizeSchedule`, which runs the
CP-SAT solver and waits for the answer.

`optimizeSchedule` exists because the backend's own planning endpoint is
asynchronous: `triggerPlan` queues a job on NATS and returns a task id to poll,
which a tool call cannot wait on. The tool builds the solver's input from
`/planner/prepare` — the same payload `triggerPlan` would send — posts it to the
optimizer's REST API (`OPTIMIZER_URL`, the `planner-api` service in
`deploy/docker-compose.yml`) and hands back the schedule without storing
anything. Its two extra arguments are what make it useful beyond "plan it
again": `locked_assignments` pins rows the caller wants kept, so the solver
fills in around an existing plan, and `constraints` relaxes or tightens a rule
for that one run without touching the tenant's saved planner settings.

`auth.py` decides which token the server's backend calls carry: whatever the
caller presented, falling back to `BACKEND_ACCESS_TOKEN`.

The server is also usable directly by any MCP client:

```bash
uv run shift-agent mcp                                # stdio
uv run shift-agent mcp --transport http --port 8900   # streamable HTTP
```

Register it with Claude Code:

```bash
claude mcp add shift-backend -- uv --directory /path/to/backend/agent run shift-agent mcp
```

## LLM providers

Selected with `SHIFT_AGENT_LLM_PROVIDER`:

| Provider | Value | Example models | Key |
|---|---|---|---|
| Ollama (local) | `ollama` | `llama3.2`, `qwen2.5`, `mistral` | — |
| Ollama.com | `ollama-com` | `llama3.2-70b`, `qwen2.5-72b-instruct` | `OLLAMA_COM_API_KEY` |
| OpenAI | `openai` | `gpt-4o`, `gpt-4o-mini` | `OPENAI_API_KEY` |

`MCP_TOOLS` narrows what the model sees to a comma-separated allowlist. Worth
setting for small local models, which choose badly from all ~70 backend
operations. Unset means everything. It does not affect the knowledge tools.

## Knowledge base

`docs/knowledge` is an [Open Knowledge
Format](https://github.com/google/open-knowledge-format) bundle: ~50 Markdown
documents, one concept each, with YAML frontmatter stating title, type,
description and tags. `agent/knowledge.py` loads it once at graph build time and
exposes three tools:

| Tool | Use |
|---|---|
| `searchKnowledge` | Keyword search over frontmatter and body; returns the best-matching documents with a snippet. |
| `readKnowledgeDoc` | One document in full, by bundle path (`concepts/shift.md`). |
| `listKnowledgeTopics` | The whole catalogue — path, title, description. |

This is what lets the agent answer "how do I confirm a plan", "what is a
capability", "why did the solver refuse" — questions the MCP tools cannot touch,
because those read state and never explain it. Retrieval is TF-IDF over the
frontmatter and body with crude stemming, not embeddings: at this corpus size
the curated frontmatter carries the signal, and there is no index to build or
model to ship.

The bundle root is fixed at startup, first match wins:

1. `--knowledge-path` on `shift-agent api` / `shift-agent chat`
2. `SHIFT_AGENT_KNOWLEDGE_PATH`
3. `backend/docs/knowledge` relative to the installed package — inside
   `deploy/Dockerfile.agent` that resolves to `/docs/knowledge`, where the image
   copies the bundle and `docker-compose.yml` pins the variable.

If the path holds no documents the tools are not bound at all: the agent keeps
working on its MCP tools and logs a warning. To check what a running agent can
actually see:

```bash
shift-agent knowledge                              # list every document
shift-agent knowledge "why is the plan infeasible" # what searchKnowledge returns
docker compose exec agent shift-agent knowledge    # …inside the container
```

## Telling the time

A model has no idea what day it is, yet most of what a ward manager asks is
anchored to now — "how many people work **today**", "who is on nights
**tomorrow**". `clock.py` binds one local tool, `currentDateTime`, returning the
date, weekday and time plus ready-made ranges for this week, next week and this
month; the system prompt tells the agent to call it before any relative-time
question. It is a tool rather than a date in the prompt because the graph is
built once per process: a date baked in at startup is wrong by the next morning.

Weekday numbering matches the rest of the system (0 = Monday … 6 = Sunday), and
`SHIFT_AGENT_TIMEZONE` sets the ward's timezone when it differs from the
server's.

That answers *when*. Answering *who* is
[`getStaffingPerDay`](api.md): one call returns the day's head count, the people
working with shift and workstation names already resolved, and the split per
shift. The agent is told to use it as it stands, because the two things it would
otherwise have to do — counting roster rows and matching employee ids to names —
are exactly what a small model gets wrong. For the same reason
`getStaffingPerDay` must be in `MCP_TOOLS` if you set that allowlist.

## Plan verification

`POST /api/v1/plan/validate` answers the question a planner has in front of a
proposed roster: *does this break any of my rules?* It is what the scheduler
page's **Verify Plan** button calls, and `validateOptimizedPlan` gives the chat
agent the same check.

```bash
curl -X POST http://localhost:8899/api/v1/plan/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"result_id": "0f2c…"}'
```

Two MCP calls gather the inputs, both as the signed-in user:

| Call | For |
|---|---|
| `getOptimizedShift(result_id)` | the proposal, including any hand edits already saved to it |
| `preparePlan(start_date, end_date)` | the rules — the same `TaskDTO` the optimizer is handed |

`validation.py` then re-derives each hard constraint of the CP-SAT model
(`planner/shift_planner/optimizer.py`) from those two payloads:

| Checked | Severity |
|---|---|
| One shift per employee per day; shift runs that weekday; employee may work it and is not absent; workstation runs that shift and is open; required qualifications held (with the same `skill_group` downgrade rule) | error |
| Recovery days after a shift, minimum rest between consecutive days, maximum consecutive days, maximum working days per seven-day block | error |
| Shift and workstation `max_employees` | error |
| Shift and workstation `min_employees`, `preferred_off`, monthly-hours deviation, skill downgrades | warning — the solver may pay these penalties, so they are not breaches |

Breaches of one rule collapse into one finding with a count and up to five named
examples. The verdict is `invalid` if anything errored, `issues` if only
warnings, else `valid`.

**No model is involved in the counting.** Only the finished report goes to the
LLM — one plain call, no tools, no history — which returns `summary`, the
written review shown under the counts. If no provider is reachable the report
still comes back, with `headline` standing in for the prose.

From the terminal:

```bash
uv run shift-agent validate <result-id>            # summary
uv run shift-agent validate <result-id> --json     # the raw report
uv run shift-agent validate <result-id> --no-explain
```

## Plan repair

`POST /api/v1/plan/fix` answers the planner's next question: *then put it
right*. It is what the scheduler page's **Fix Plan** button calls, next to the
note they can type alongside it, and `repairOptimizedPlan` gives the chat agent
the same repair.

```bash
curl -X POST http://localhost:8899/api/v1/plan/fix \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"result_id": "0f2c…",
       "instruction": "Anna is off sick on the 12th, leave the night team alone",
       "strategy": "repair"}'
```

The split is the same as the check's, and for the same reason.

**The moves are arithmetic.** `repair.py` re-derives every hard constraint as a
question about a single placement (`_Rules.blocking_reason`) and then makes one
pass over the plan: each row that breaks a rule is moved to a place the solver
could have chosen — the same shift at another station first, since that keeps
the day's rhythm, then another shift — and removed when there is none. Because
removing an assignment can never break a hard rule, one pass is enough to leave
none behind. A second pass fills what is below its minimum, stations in priority
order, each opening going to the eligible person with the fewest hours so far —
the same fairness objective the solver optimises.

**The user's sentence is the model's.** `parse_instruction` hands the note to
the LLM as a *translation* job, with the ward's own employees, shifts,
workstations and dates in front of it, and gets back concrete directives:
unassign, assign, protect, per-run constraint overrides, or "re-solve this". Each
one is then checked like any other move — an instruction that would break a rule
is refused with the reason, in `rejected`, rather than forced.

| `strategy` | What happens | Cost |
|---|---|---|
| `repair` (default) | Local moves, as above. Rows that were already fine are not touched. | Seconds |
| `resolve` | The whole period goes back to CP-SAT via `optimizeSchedule`, with only what the planner pinned in `locked_assignments`. | A solve — minutes |

Either way the repaired plan is written back through `updateOptimizedShift` —
the same endpoint the scheduler page's own edits use — and re-checked with
`validation.validate`. So `after` in the response is a full verification report
of what was actually stored, produced by the same counting as the check that
sent the planner here; the two cannot disagree. `summary` is the LLM's write-up
of the whole thing, and falls back to `headline` when no provider is reachable.

From the terminal:

```bash
uv run shift-agent fix <result-id> -i "take Anna off Thursday"
uv run shift-agent fix <result-id> --strategy resolve --dry-run   # nothing saved
uv run shift-agent fix <result-id> --json
```

## Short-notice replacement

`POST /api/v1/roster/replacements` answers *"Anna is sick tomorrow — who can
take her shift?"* for the **confirmed** roster, the one people are working to.

```bash
curl -X POST http://localhost:8899/api/v1/roster/replacements \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"employee_id": "<anna>", "date": "2026-09-26"}'
```

It reads the rules for the date's month (`preparePlan`, which carries personal
limits and the settings) and the confirmed roster from 14 days before that
month to 14 days after it, then asks the repair's own question —
`_Rules.blocking_reason` — of every colleague for Anna's shift and workstation:
away or absent, not qualified, does not work that shift, already working that
day, the station already at its maximum, recovery days, minimum rest, too long
a streak, the weekly day cap, a hard personal limit. Whoever is ruled out comes
back in `unavailable` with that reason. Everyone else is in `candidates`,
ranked:

1. a shift wish for exactly that slot;
2. not on one of their preferred days off;
3. furthest below their hours target for the month;
4. most rest since their last shift.

A colleague whose day is a planned day off (a `free` row, as *Take as Plan*
writes) counts as available, and their `free_plan_id` names the row the new
shift replaces — there is one row per person and day. `slot.staffed_without`
with `min_employees` / `max_employees` says whether anyone is needed at all.

Nothing is written. On the Schedule page, *Find replacement…* in a cell's menu
opens the list; *Assign* marks the absent person (sick, vacation or absent) and
puts the colleague on the shift through the ordinary confirmed-plan endpoints.

## Roster uploads

`POST /api/v1/chat/upload` takes a shift plan the ward already has — a
spreadsheet, a CSV, or a PDF printed from one — and turns it into
[shift assignments](knowledge/concepts/shift-assignment.md), with the user's
confirmation in between.

```mermaid
sequenceDiagram
    participant U as User
    participant S as server.py
    participant R as roster.py
    participant G as graph (LLM)
    participant B as backend

    U->>S: multipart file
    S->>R: parse + stage grid
    S->>G: "a roster was attached" + first rows
    G->>R: interpretRosterUpload(layout)
    R->>B: importShiftAssignments(dry_run) via MCP
    B-->>R: what would be written
    G-->>U: "I read 28 people, 1–30 September…  take it?"
    U->>G: yes
    G->>R: applyRosterUpload
    R->>B: importShiftAssignments via MCP
```

Two decisions shape this.

**The grid never reaches the model.** A month's roster is thirty people by
thirty days — nine hundred cells. Having the model transcribe those into tool
arguments would be slow, expensive, and wrong in the way transcription always
is, with nothing to check it against. So the model supplies only the *layout*:
which column holds the names, which row holds the dates, which month it is,
which codes mean a day off. A dozen numbers it reads off the preview. The
expansion from layout to nine hundred assignments happens in `roster.py`, in
Python, identically every time. The grid itself stays in the upload store.

**Nothing is written before the user agrees.** `interpretRosterUpload` dry-runs
the import and hands back the backend's own resolution report — which names
matched which employees, which codes matched which shifts, and what matched
nothing. The agent shows that and waits. `applyRosterUpload` replays exactly the
staged rows, so what lands is what was shown.

The writes still go through MCP like every other backend call: `roster.py` is
handed `MCPClient.call_sync` and invokes `importShiftAssignments` directly,
without the model in the loop. That means the tool works even when `MCP_TOOLS`
is set — the allowlist filters what is *bound to the model*, not what the agent
can call. The backend endpoint (`POST /shift-assignments/import`) matches
employees by full name, email, id or surname-first spelling, and shifts by name,
short name or id, because a roster document has names and no ids.

Formats, in descending order of how well they read: **XLSX** (real cells),
**CSV** (real cells, delimiter and encoding sniffed — cp1252 included, since
that is what German Excel writes), **PDF** (no cells at all — `pdfplumber`
recovers ruled tables exactly, infers columns from text alignment where there
are no rules, and falls back to splitting lines on wide gaps; a scan has no text
and is rejected with an explanation). Uploads are capped at 10 MB and expire
from the store after six hours.

## Context window

Every tool result stays in the session's history, and a session lives as long as
the process, so a busy chat grows steadily. Before each LLM call
`graph.py`'s `_fit_to_context` drops the oldest turns until what is sent fits
`SHIFT_AGENT_MAX_CONTEXT_TOKENS` (default 131072) minus the reply's
`SHIFT_AGENT_MAX_TOKENS`, keeping 15% back for the bound tool schemas that the
approximate token count cannot see.

- The system prompt is always kept, and the kept history starts at a user
  message — a tool result whose tool call has been trimmed away is a malformed
  conversation that providers reject.
- Only what is *sent* is capped. The full history stays in the checkpointer, so
  nothing is lost from the session itself.
- Set the variable to your model's real window: 131072 suits gpt-oss and
  llama 3.x, gpt-4o is 128000, small local models are often 8192.

## Running it

```bash
cd agent
make install
cp .env.example .env
make mcp-http     # MCP server on :8900 — the agent needs it
make api          # chat API on :8899
make chat         # or a terminal session
```

Outside Docker, set `MCP_SERVER_URL=http://localhost:8900/mcp` — the default
targets the `mcp` Compose service. If the MCP server isn't up, the first chat
request returns 503 and the next retries.

## Chat API

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

Attaching a roster file is the same conversation, over multipart:

```bash
curl -X POST http://localhost:8899/api/v1/chat/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@dienstplan_september.xlsx" \
  -F "session_id=default" \
  -F "message=this is September"
```

The reply is the same shape, plus an `upload` object naming the staged file and
its sheets. Confirming ("yes, take it") is an ordinary `POST /api/v1/chat` on
the same `session_id` — see [Roster uploads](#roster-uploads).

With no Keycloak configured (`KEYCLOAK_JWKS_URL` / `KEYCLOAK_REALM_URL` unset),
the endpoint accepts unauthenticated requests — development only.

## Token flow

One token travels the whole way: the user's. See
[Auth & Multi-Tenancy](auth.md) for the full chain. In short:

1. APISIX sets `X-Access-Token` on the chat route; `agent/server.py` verifies it
   against Keycloak's JWKS and puts it in a contextvar.
2. `agent/client.py` reads it back on every tool call and sends it as
   `Authorization: Bearer`.
3. `mcp/auth.py` attaches it to the backend call.

Every backend call therefore runs as the signed-in user, under that user's
tenant — the agent has no privileges of its own.

## Extending it

| Goal | What to do |
|---|---|
| New backend capability | Add it to `api/openapi.yaml` and the Rust backend. The MCP server picks it up automatically; add the name to `MCP_TOOLS` if you use an allowlist. |
| New navigable page | Add it to `KNOWN_PAGES` in `mcp/server.py` and to `ui/src/app/app.routes.ts`. |
| New rule to check in a plan | Add a `_check_*` method to `_Validator` in `agent/shift_agent/agent/validation.py` and call it from `run()`. Keep it in step with the constraint in `planner/shift_planner/optimizer.py` it mirrors. |
| Persistent history | Swap `MemorySaver` in `agent/graph.py` for `SqliteSaver` or `PostgresSaver`. |
| Streaming replies | Use `graph.astream(...)` instead of `graph.ainvoke(...)` in `agent/server.py`, returned as chunked or SSE. |
