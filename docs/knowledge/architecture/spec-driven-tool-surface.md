---
type: Design Decision
title: Spec-Driven Tool Surface
description: Why the chat agent has no hand-written backend tools — the MCP server is generated from api/openapi.yaml at startup, making the spec load-bearing.
resource: agent/shift_agent/mcp/server.py
tags: [architecture, decision, mcp, openapi, agent]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/agent.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: docs/api.md
    author: human:maxrg
    last_modified: 2026-07-25
---

# Decision

The MCP server builds its entire tool surface with `FastMCP.from_openapi()` at
startup, reading `api/openapi.yaml`. Every backend operation becomes one MCP tool
automatically. There are **no hand-written wrappers**, with a single exception:
`navigate`, which has no REST equivalent because it targets the browser rather
than the backend.

# Rationale

Hand-written tool wrappers are a second description of the same API, and second
descriptions drift. The failure mode is quiet: the agent keeps calling an endpoint
with a parameter that was renamed six weeks ago, and nobody notices until a user
asks it to do that one thing.

Generating from the spec collapses the two descriptions into one. Adding an
endpoint to `api/openapi.yaml` and the Rust backend makes it agent-callable with
no agent code change at all.

# Consequences

**`api/openapi.yaml` is not documentation — it is a runtime input.** An endpoint
missing from the spec is an endpoint the assistant cannot use. An endpoint
described *wrongly* in the spec is one the assistant will call wrongly. The spec
must be updated in the same change as the route, not afterwards.

**Tool count is a real constraint.** All ~70 backend operations become tools.
Small local models choose badly from a list that long, which is why `MCP_TOOLS`
exists as a comma-separated allowlist narrowing what the model sees. Unset means
everything.

**Navigation needs two edits.** A new UI page must be added to
`ui/src/app/app.routes.ts` *and* to `KNOWN_PAGES` in
`agent/shift_agent/mcp/server.py`, since `navigate` is the one tool the generator
does not produce.

**The agent gains no privileges from this.** Generated tools call the backend with
the signed-in user's token, so the assistant can do exactly what that user can do,
in that user's tenant, and no more. See
[Gateway and identity](/architecture/gateway-and-identity.md).

# Related

* [Agent and MCP service](/architecture/agent-and-mcp-service.md)
* [MCP tool surface](/interfaces/mcp-tool-surface.md)
* [REST API](/interfaces/rest-api.md)
