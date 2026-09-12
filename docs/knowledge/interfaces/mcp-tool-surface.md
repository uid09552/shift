---
type: API Surface
title: MCP Tool Surface
description: One MCP tool per OpenAPI operation plus two hand-written tools (navigate, optimizeSchedule) — transports, allowlisting, auth and registration.
resource: agent/shift_agent/mcp/server.py
tags: [interfaces, mcp, agent, tools]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: agent/shift_agent/mcp/server.py
    author: human:maxrg
    last_modified: 2026-07-26
  - resource: docs/agent.md
    author: human:maxrg
    last_modified: 2026-07-25
---

`FastMCP.from_openapi()` turns `api/openapi.yaml` into one MCP tool per operation
at startup — roughly 70 of them. Only `navigate` and `optimizeSchedule` are
hand-written. The reasoning is in
[Spec-driven tool surface](/architecture/spec-driven-tool-surface.md).

# What the tools are

Names follow the OpenAPI `operationId`s, so the surface mirrors the
[REST API](/interfaces/rest-api.md) one-for-one: `listEmployees`, `createShift`,
`setShiftWeekdayTime`, `triggerPlan`, `getPlanStatus`, `takeOptimizedShiftAsPlan`,
`getPlannerSettings`, `updatePlannerSettings`, `listAuditLogs`, and so on.

Adding an operation to the spec adds a tool. Removing one removes a tool. There is
no separate registry to keep in step.

# The two exceptions

`navigate` has no REST equivalent — it targets the browser. `agent/server.py`
converts a `navigate` call into a `ui_action` in the chat response:

```json
{"session_id": "default", "reply": "...", "ui_action": {"action": "navigate", "path": "/planner-settings"}}
```

Its destinations come from `KNOWN_PAGES` in `agent/shift_agent/mcp/server.py`,
which must be kept in step with `ui/src/app/app.routes.ts` by hand.

`optimizeSchedule` has a REST equivalent that cannot be used from a tool call:
`triggerPlan` queues a solve on NATS and returns a task id to poll for
(see [Planning pipeline](/architecture/planning-pipeline.md)). The tool is the
synchronous path — it builds the solver's input from `/planner/prepare`, the
same payload the queued job would carry, posts it straight to the optimizer's
REST API (`OPTIMIZER_URL`, the `planner-api` service in Compose) and returns the
schedule. Nothing is stored.

```
optimizeSchedule(start_date, end_date, employee_ids?, constraints?,
                 locked_assignments?, include_plan?)
  -> { status, objective_value, planning_period, message, summary,
       employee_plans?, schedule? }
```

Two arguments carry the weight. `constraints` overrides the tenant's
[planner settings](/concepts/planner-settings.md) for that one run, so "what
would this look like with ten hours' rest instead of eleven" costs a solve and
changes nothing. `locked_assignments` pins rows the solver must keep, which is
what lets a re-solve repair a plan rather than replace it — see
[Optimizer contract](/interfaces/optimizer-contract.md) and the repair behind
the scheduler page's **Fix Plan** button.

# Transports

```bash
uv run shift-agent mcp                                # stdio
uv run shift-agent mcp --transport http --port 8900   # streamable HTTP
```

Register with an MCP client:

```bash
claude mcp add shift-backend -- uv --directory /path/to/backend/agent run shift-agent mcp
```

In Compose, the `mcp` service runs the `agent` image with a different command on
port 8900. The chat agent reaches it at `MCP_SERVER_URL`; outside Docker set
`MCP_SERVER_URL=http://localhost:8900/mcp`.

# Narrowing the surface

`MCP_TOOLS` is a comma-separated allowlist of tool names. Unset means everything.
Setting it matters for small local models, which choose badly from ~70 options.
When you add a backend capability *and* use an allowlist, add the new tool name
too — otherwise the model never sees it.

# Auth

Backend calls carry whatever token the caller presented, falling back to
`BACKEND_ACCESS_TOKEN`. With `MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET`
set, the HTTP server also verifies incoming clients itself via `MultiAuth`
(Keycloak authorization code grant with Dynamic Client Registration, or a bearer
token — `make mcp-token` fetches one). Both are deliberately blanked for the `mcp`
Compose service; details and the reason in
[Gateway and identity](/architecture/gateway-and-identity.md).

The practical consequence: an MCP client acts as the token's owner, in that
owner's tenant, with that owner's role. `shift-viewer` gets 403 from every mutating
tool.

# Related

* [Agent and MCP service](/architecture/agent-and-mcp-service.md)
* [Using the assistant](/guide/using-the-assistant.md) - the user-facing view
