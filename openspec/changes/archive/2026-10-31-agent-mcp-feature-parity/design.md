# Design

## Context

See proposal.md for the motivation.

Relevant current state:

- **MCP server.** `shift_agent/mcp/server.py` is
  `FastMCP.from_openapi(api/openapi.yaml)` plus two hand-written tools,
  `navigate` and `optimizeSchedule`. It sends backend calls through one
  `httpx.AsyncClient` with `BackendTokenAuth`, which resolves the *incoming*
  MCP request's token from FastMCP's request context. The REST paths and the
  spec match; only `/self` and `/health` are not in the spec.
- **The agent's rule engines.**
  - `validation.collect/validate`, `repair.fix`, `replacement.search` and
    `replacement.check_swap` are synchronous.
  - They reach the backend only through a `call_mcp(tool_name, args) -> str`
    callable, using operation ids such as `getOptimizedShift`, `preparePlan`,
    `updateOptimizedShift` and `listConfirmedShiftPlans`.
  - Today that callable is the chat agent's `MCPClient.call_sync`, which calls
    the remote MCP server over HTTP with the token resolved on the caller's
    stack.
- **The agent's HTTP routes.** `/plan/validate`, `/plan/fix`,
  `/roster/replacements` and `/roster/swap-check` are used by the UI (the
  scheduler page, *Find replacement…*) and by the backend
  (`shift_swap.rs` → swap-check).
- **The LLM.** `build_llm` / `plain_llm` live in `agent/graph.py`. The repair
  uses `plain_llm` only to translate the planner's instruction. The HTTP
  `/plan/fix` route additionally narrates the report.
- **Both processes run the same image** with the same `.env`
  (`deploy/docker-compose.yml`, services `agent` and `mcp`). So the MCP
  container already receives the LLM settings.
- **The change-reason header.** `X-Change-Reason` is a declared header
  parameter (`#/components/parameters/ChangeReason`) on nine operations, so the
  generated tools already accept it as an argument.
- **Identity.** The backend's `UserContext` carries `subject`, `username` and
  `email` from the token. `shift_swap::caller_employee` matches an employee by
  `email`, then `username`.

## Goals / Non-Goals

**Goals:**
- One implementation of the check, the repair, the replacement and the swap
  check, reachable from the UI, the backend, the chat and external MCP clients.
- The tools on the MCP server run as the MCP caller, never as a service
  identity.
- The chat handles guarded roster writes correctly without relying on the
  model to percent-encode.

**Non-Goals:**
- Changing what the rule engines compute. Repair stability over
  `published_roster` / `fixed_shifts` is a separate change.
- Moving the agent's HTTP routes to the MCP server, or changing their payloads.
- Exposing the roster-upload tools on MCP. They depend on a file the chat
  widget uploaded into the agent's process.

## Decisions

### 1. The rule engines run inside the MCP server against an in-process `call_mcp`

The four new MCP tools call the existing module functions unchanged. They pass
an adapter that dispatches `call_mcp(name, args)` to the MCP server's *own*
registered tools, in process, instead of over HTTP back to itself.

```
MCP request (caller token T)
  -> validateOptimizedPlan tool (async)
       token = resolve T now, on the request's context
       -> anyio.to_thread.run_sync(validation.collect/validate, call_mcp)
            call_mcp(name, args)
              -> anyio.from_thread.run(own_tool(name).run(args))  [token override = T]
                   -> generated tool -> httpx (BackendTokenAuth sees T) -> backend
```

- **Token.** The token is resolved once, at tool entry. It is then pinned for
  the nested calls through a token-override contextvar that `mcp/auth.py`'s
  `_incoming_token()` consults first. This is the same "resolve on the caller's
  stack, pass it down" rule `MCPClient.call_sync` follows. Thread hops and
  nested tool runs then cannot lose it, whether or not FastMCP's own request
  context survives them.
- **Sync over async.** The engines are synchronous and make many sequential
  calls. They run in a worker thread, and each `call_mcp` hops back to the
  server's event loop. Rewriting them as async is out of proportion to the
  goal.
- **Alternatives considered:**
  - An HTTP loopback to the server's own `/mcp` URL: an extra network hop,
    plus a second auth verification per call.
  - Calling the backend directly by path: this duplicates the OpenAPI
    operation-to-path mapping that FastMCP already holds.
  - Keeping the engines in the agent and having the MCP server call the
    agent's HTTP routes: a circular dependency between the two services, and
    it leaves the agent as a required runtime for MCP clients.
- **Spike (done).** The lockfile now pins FastMCP 4.1.4, whose public
  `FastMCP.call_tool(name, arguments)` runs a registered tool by name,
  middleware included — no private registry needed. Task 1.2's test shows
  the override reaching `BackendTokenAuth`.

### 2. One LLM factory, imported by both processes

`build_llm` and `plain_llm` move from `agent/graph.py` to `shift_agent/llm.py`.
`graph.py` and the MCP server's repair tool both import them.

- The MCP server builds the model lazily, on the first instruction that needs
  it. A server without LLM settings therefore still starts and serves
  everything else, and an empty instruction never builds the model.
- The narration (`repair.narrate`) stays on the agent's HTTP route only. An MCP
  caller has its own model to explain the change log, which is how the chat
  tool behaves today ("nothing here narrates").
- **Alternative considered:** a structured instruction supplied by the caller.
  It was declined in discussion: the free-text instruction is the feature, and
  external clients should get the same semantics as the *Fix Plan* button.

### 3. The chat agent drops its local copies of the check and the repair

`graph.py` stops binding `build_validation_tools` / `build_repair_tools`. The
chat picks `validateOptimizedPlan` and `repairOptimizedPlan` up from MCP, along
with `findReplacement` and `checkShiftSwap`, like every other backend tool.

- Keeping both copies would bind two tools with the same name, which the model
  binding rejects.
- The local tool builders are deleted. The modules stay, because the HTTP
  routes still call them directly.
- `client.LONG_RUNNING_TOOLS` gains `repairOptimizedPlan` (`resolve` runs a
  solve).
- `validateOptimizedPlan` stays on the short timeout: it makes many calls, but
  each one is fast. Task 2.4 measures it on a month-sized plan and moves it to
  the long timeout if it exceeds `MCP_TIMEOUT_SECONDS`.

### 4. `X-Change-Reason` is encoded by the MCP server, not by the model

A tool-call middleware on the MCP server normalises the `X-Change-Reason`
argument before the generated tool builds its request: it decodes the value
(an already-encoded value comes back unchanged), then percent-encodes it as
UTF-8. Not an `httpx` request hook, as first planned: httpx refuses a
non-ASCII header value when the request is built, before any hook runs.

- The model passes the user's words verbatim. The spec's "sent URL-encoded"
  then holds regardless of the model.
- This also protects external MCP clients.
- **Alternative considered:** instructing the model to encode. That is
  unreliable for umlauts, and a raw non-ASCII header fails before the backend
  ever sees it.
- The generated tools name the argument `X-Change-Reason` (nine of them take
  it). The prompt names that exact argument.

### 5. `/self` falls back to token claims and adds `employee_id`

`auth::get_self` starts from `UserContext` (subject, username, email) and
overlays the gateway's `x-userinfo` when that header is present. It then adds
`employee_id` via `shift_swap::caller_employee`. To share that helper, it moves
to a module both services can use, or becomes `pub(crate)` in place.

`getSelf` goes into `api/openapi.yaml`, so the MCP server generates the tool
like any other.

**Alternative considered:** the chat agent decodes the token it already
verified and injects roles into the prompt. That gives no `employee_id`, and
external MCP clients would get nothing.

### 6. The system prompt is reorganised by task, not by tool

The prompt today is a tool list plus "who is working" rules. The rewrite keeps
those rules and adds short sections:

- **Who am I talking to.** Call `getSelf` once per session before anything
  personal or permission-dependent.
- **Changing the roster.** Month status and the freeze window; ask for the
  reason; warn that a published write notifies people; publish/lock.
- **Absences and replacements.**
- **Swap requests.**
- **Rotations.** `dry_run` first.
- **Personal limits and labor law.** Explain from the documentation; never show
  a protected-group reason.
- **Automatic planning.** Read `auto_plan_last_*`.

Tool descriptions stay with the tools (the OpenAPI summaries and the new MCP
tools' docstrings). The prompt names a tool only where the choice between tools
matters. That holds the added prompt length to the minimum the behaviours need.

### 7. Knowledge: one concept page per feature, guides cross-link

New pages follow the existing frontmatter (title, type, description, tags):

- `concepts/roster-lifecycle.md`: draft/published/locked, freeze window,
  reasons, deadlines;
- `concepts/roster-change-notice.md`;
- `concepts/rotation-pattern.md`;
- `concepts/personal-limits.md`;
- `concepts/labor-law-profile.md`;
- `concepts/automatic-planning.md`;
- `guide/short-notice-replacement.md`.

Also updated:
- `concepts/shift-swap.md` (approval flow, swap check);
- `guide/using-the-assistant.md`;
- `interfaces/mcp-tool-surface.md` (the four tools, `getSelf`);
- `architecture/agent-and-mcp-service.md`;
- `index.md` and `log.md`.

Content is taken from the archived changes' specs (`openspec/specs/*`), not
re-derived.

## Risks / Trade-offs

- [The MCP server now needs an LLM for one tool argument] → The model is built
  lazily, and an empty instruction never needs it. Without an LLM, a non-empty
  instruction gets a clear error and nothing is written (see the spec).
- [Thread hop plus nested tool runs lose the caller's identity, and a call runs
  as `BACKEND_ACCESS_TOKEN`] → The explicit token override (Decision 1). A test
  asserts that a nested call carries the outer token, and that a missing token
  never silently becomes the fallback when the outer request had one.
- [The tool surface grows and so does the prompt; small local models lose
  accuracy] → Four tools and roughly 40 prompt lines. `MCP_TOOLS` still lets a
  deployment narrow the surface. `_fit_to_context` already budgets for the tool
  schemas.
- [Deployments with an `MCP_TOOLS` allowlist lose `validateOptimizedPlan` /
  `repairOptimizedPlan` in the chat, because they used to be local] → The
  README and `.env.example` note it. `MCPClient.connect` already warns about
  unknown names, and the migration step below says to add them.
- [`repairOptimizedPlan` with `resolve` outlives the MCP client's timeout] →
  `LONG_RUNNING_TOOLS`, and the `mcp` service's optimizer timeout is unchanged.

## Migration Plan

1. Deploy the backend with `getSelf` in the spec and the `/self` fallback. This
   is backwards compatible: fields are only added.
2. Deploy the `mcp` service with the new tools. It already reads `.env`; check
   that the LLM provider is reachable from its network (`dev_backend`/Ollama).
3. Deploy the `agent` service. If `MCP_TOOLS` is set, add
   `validateOptimizedPlan`, `repairOptimizedPlan`, `findReplacement`,
   `checkShiftSwap` and `getSelf`.
4. Rollback: revert the agent image. The old agent binds its local check and
   repair. The MCP server's new tools are additive and harmless to an old
   agent, except for a duplicate tool name. So roll back `mcp` together with
   `agent`, or set `MCP_TOOLS` on the old agent.
