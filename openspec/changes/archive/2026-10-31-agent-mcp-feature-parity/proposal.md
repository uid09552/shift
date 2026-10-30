# Proposal

## Why

Since mid-September the product gained a roster lifecycle (publish, freeze
window, lock, `X-Change-Reason`), change notices, shift swaps, short-notice
replacement, rotation patterns, personal limits, a labor-law profile and
automatic planning. Every REST operation is already an MCP tool, because the
MCP server is generated from `api/openapi.yaml`. The hand-written parts around
it have not kept up:

- The chat agent's system prompt was last changed on 2026-09-15 and names none
  of these features.
- The plan check and repair exist only inside the chat agent. Replacement and
  swap check exist only as HTTP routes. An external MCP client (Claude Code,
  Claude Desktop) can start a solve, but it cannot check one, repair one or
  find a replacement, and the chat cannot find a replacement either.
- No tool tells the agent who the caller is.
- `navigate` does not know three pages.
- The knowledge bundle says nothing about the freeze window, change notices,
  ArbZG or automatic planning.

So the assistant fails exactly on the questions the new features raise: "why
can't I change the 3rd?", "Anna is sick tomorrow, who can cover?", "when do I
work next week?".

## What Changes

- **The MCP server serves the agent's own tools.** It adds four tools:
  `validateOptimizedPlan`, `repairOptimizedPlan`, `findReplacement` and
  `checkShiftSwap`. They run the same code as the agent's HTTP routes, so an
  external client gets the same answers as the scheduler page.
  `repairOptimizedPlan` reads the planner's free-text instruction with an LLM
  configured on the MCP server, using the same `SHIFT_AGENT_LLM_PROVIDER` and
  model settings the agent uses today.
- **The chat agent gets these tools through MCP** and drops its local copies of
  the check and the repair. One implementation remains, and the chat gains
  replacement and swap check. The agent's HTTP routes (`/plan/validate`,
  `/plan/fix`, `/roster/replacements`, `/roster/swap-check`) stay as they are
  for the UI and the backend.
- **"Who am I".** `GET /self` goes into the OpenAPI spec (`getSelf`). When the
  gateway's user-info header is missing, as it is for MCP calls, it falls back
  to the token's own claims. It also returns the caller's `employee_id`, matched
  by e-mail the same way shift swaps already do.
- **Roster-lifecycle awareness in the chat.** The system prompt covers:
  - month status and the freeze window, and asking for a reason before a write
    that needs one (sent URL-encoded as `X-Change-Reason`);
  - that writes to a published month notify staff;
  - publish/unpublish/lock, and change notices;
  - swap requests, replacement and rotation patterns (always `dry_run` first);
  - personal limits and automatic planning.

  It also answers role-aware, using `getSelf`: viewers get their own shifts,
  wishes and swaps, and are not offered writes they cannot make.
- **`navigate`** learns `changes`, `relationships` and `users`.
- **Knowledge bundle.** New documents cover the roster lifecycle, change
  notices, rotation patterns, personal limits, the labor-law profile, automatic
  planning, short-notice replacement and the assistant's MCP tools. The guides
  and the MCP tool-surface page are updated to match.

Out of scope:
- Repair keeping published days and rotations stable (`published_roster`,
  `fixed_shifts`). That is a correctness change to the repair algorithm and gets
  its own change.
- New UI.

## Capabilities

### New Capabilities
- `mcp-tool-surface`: what the MCP server exposes beyond the generated REST
  operations: the plan check, the repair, the replacement search, the swap
  check and `navigate`'s pages. It also covers
  that these tools run as the caller.
- `chat-assistant`: how the in-app assistant behaves on roster writes, roles and
  the newer features, and which documentation it answers from.

### Modified Capabilities
- `user-management`: adds the caller-identity endpoint (`GET /self` with roles
  and `employee_id`, which works without the gateway header).

## Impact

- `agent/shift_agent/mcp/server.py`: register the four tools, the `navigate`
  pages; add an in-process `call_mcp` adapter.
- `agent/shift_agent/agent/graph.py`:
  - `build_llm` / `plain_llm` move to a module both processes can import;
  - the local validation and repair tools are removed;
  - the system prompt is rewritten.
- `agent/shift_agent/agent/client.py`: `LONG_RUNNING_TOOLS` gains
  `repairOptimizedPlan`.
- `deploy/docker-compose.yml`: the `mcp` service needs the LLM settings (it
  already reads `.env`) and a longer MCP timeout for repair.
- `src/services/auth.rs`: `/self` falls back to token claims and returns
  `employee_id`.
- `api/openapi.yaml`: `getSelf`.
- `docs/knowledge/**`: new and updated documents.
- `agent/README.md`: updated to describe the moved tools.
- `agent/tests`: tests for the new tools and the adapter.
