# Tasks

## 1. MCP server: the agent's tools, in process

- [x] 1.1 Spike: find FastMCP 3.4.x's server-side way to run a registered tool by name, and record it in a comment on the adapter. Verify it with a throwaway test that runs a generated tool in process and gets its text result. If there is no public API, use the name → `Tool` map from `get_tools()` (design, Decision 1).
- [x] 1.2 Add a token-override contextvar to `shift_agent/mcp/auth.py` that `_incoming_token()` consults first, with a set/reset helper. Verify with a test in `agent/tests/test_mcp_adapter.py`: a nested call made under an override sends that token in `X-Access-Token`, and it never falls back to `BACKEND_ACCESS_TOKEN` while an override is set.
- [x] 1.3 Add the in-process `call_mcp` adapter to the MCP server: resolve the token at tool entry, run the sync engine via `anyio.to_thread.run_sync`, and dispatch each call back to the loop under the override. Verify with a test that a stub engine making three sequential `call_mcp` calls through a mocked backend gets three results, each carrying the outer token.
- [x] 1.4 Move `build_llm` / `plain_llm` from `agent/graph.py` to `shift_agent/llm.py`, and import them from `graph.py`. Verify that `make test` passes and that `shift-agent chat` still starts.
- [x] 1.5 Register `validateOptimizedPlan(result_id)`, `findReplacement(employee_id, date)` and `checkShiftSwap(requester, colleague)` on the MCP server, calling `validation.collect/validate` + `headline`, `replacement.search` and `replacement.check_swap` through the adapter. Errors (`ValidationError`, `RepairError`) are returned as `{"error": …}`. Verify with tests that feed the same mocked backend data to each tool and to the matching agent HTTP route and assert equal JSON, plus an unknown-id error case.
- [x] 1.6 Register `repairOptimizedPlan(result_id, instruction, strategy)`, with the LLM built lazily from `shift_agent.llm` only for a non-empty instruction. When no LLM is reachable, a non-empty instruction returns an error and nothing is saved. Verify with tests that:
  - an empty instruction never builds the LLM;
  - the no-LLM case makes no `updateOptimizedShift` call;
  - a repair with a stub LLM saves through `updateOptimizedShift`.
- [x] 1.7 Find the argument name `from_openapi` gives `X-Change-Reason` on the generated tools, by listing a tool's `inputSchema` in a test. Add a tool-call middleware in `mcp/server.py` that decodes and then UTF-8 percent-encodes that argument before the request is built (an `httpx` hook is too late: httpx rejects the raw value). Verify with a test that "Krankmeldung Müller" and its already-encoded form both arrive as `Krankmeldung%20M%C3%BCller`.
- [x] 1.8 Add `changes`, `relationships` and `users` to `KNOWN_PAGES` and to `navigate`'s docstring. Verify with a test that each page resolves to `/changes`, `/relationships` and `/users`, and that an unknown page lists them.
- [x] 1.9 Update `agent/README.md` (the MCP server section and the architecture diagram) and `docs/knowledge/interfaces/mcp-tool-surface.md` with the four tools. Verify that the README names each tool and states that it runs as the caller.

## 2. Chat agent: use the tools from MCP

- [x] 2.1 Stop binding `build_validation_tools` / `build_repair_tools` in `graph.py` and delete those builders. The modules stay for the HTTP routes. Verify that `shift-agent chat` against a local MCP server lists `validateOptimizedPlan`, `repairOptimizedPlan`, `findReplacement` and `checkShiftSwap` exactly once each.
- [x] 2.2 Add `repairOptimizedPlan` to `client.LONG_RUNNING_TOOLS`. Verify with a unit test that `_session` picks `mcp_long_timeout_seconds` for it.
- [x] 2.3 Document in `deploy/.env.example` and `agent/README.md` that an `MCP_TOOLS` allowlist must now include the four tools and `getSelf`. Verify that both files name all five.
- [ ] 2.4 Time `validateOptimizedPlan` through MCP on a month-sized stored result in the local stack. If it exceeds `MCP_TIMEOUT_SECONDS`, add it to `LONG_RUNNING_TOOLS`. Verify by recording the measured time in the PR description.

## 3. Backend: caller identity

- [x] 3.1 Make `auth::get_self` start from `UserContext` (subject, username, email), overlay `x-userinfo` when it is present, and add `employee_id` via `shift_swap::caller_employee` (made reachable from `auth.rs`). Verify with Rust tests:
  - no header still gives username and email from the token;
  - a matching e-mail gives the employee id;
  - no match gives null.
- [x] 3.2 Add `GET /self` to `api/openapi.yaml` as `getSelf`, with a `UserInfo` schema that includes `roles` and `employee_id`. Verify that the spec validates (the project's OpenAPI lint or `make check`) and that a test listing the MCP server's tools finds `getSelf`.

## 4. Chat assistant: the system prompt

- [x] 4.1 Rewrite `SYSTEM_PROMPT` in `graph.py` by task (design, Decision 6). Keep the "who is working" and roster-upload rules. Add sections for:
  - who am I (`getSelf` once per session);
  - changing the roster (month status, freeze window, ask for the reason and pass it verbatim in the reason argument from 1.7, warn about change notices, confirm publish/unpublish/unlock/lock);
  - replacements;
  - swaps (check first, warnings only);
  - rotations (`dry_run` first);
  - personal limits and labor law (explain from the docs, never a protected-group reason);
  - automatic planning (`auto_plan_last_*`).

  Extend `navigate`'s page list. Verify by reviewing it against each requirement in `specs/chat-assistant/spec.md`; every requirement maps to a prompt line.
- [ ] 4.2 Add one request per chat-assistant scenario to the `agent/chat` collection: freeze-window edit, 428 retry, publish, sick replacement, swap approval, rotation apply, a viewer's "my shifts", a viewer asking to publish, the auto-plan reason. Verify by running them against the local stack: each answer follows its scenario's THEN, with no write made before confirmation (checked in the audit log).

## 5. Knowledge bundle

- [x] 5.1 Write `concepts/roster-lifecycle.md`, `concepts/roster-change-notice.md` and `concepts/automatic-planning.md` from `openspec/specs/roster-publication`, `roster-change-notices` and `automatic-planning`. Verify that `shift-agent knowledge` lists them and that `searchKnowledge("freeze window")` and `searchKnowledge("auto plan proposal")` rank them first.
- [x] 5.2 Write `concepts/rotation-pattern.md`, `concepts/personal-limits.md` and `concepts/labor-law-profile.md` from `openspec/specs/rotation-patterns`, `personal-limits` and `labor-law-profile`. The labor-law page states that it covers a modelled subset of the law and is not legal advice. Verify that `searchKnowledge("ArbZG")` and `searchKnowledge("max nights per month")` find them.
- [x] 5.3 Write `guide/short-notice-replacement.md`, and update `concepts/shift-swap.md` (the approval flow and the swap check), `guide/using-the-assistant.md` (what the assistant can now do, by role) and `architecture/agent-and-mcp-service.md` (where the tools now live). Verify that `searchKnowledge("who can cover sick")` finds the guide.
- [x] 5.4 Add the new pages to `docs/knowledge/index.md` and its section `index.md` files, and add an entry to `log.md`. Verify that `shift-agent knowledge` reports no page missing from an index.

## 6. Integration

- [ ] 6.1 Run the full stack (`deploy/docker-compose.yml`) and connect Claude Code to the `mcp` service with a planner token. Then check a stored plan, repair it with an instruction, find a replacement and check a swap. Verify that the answers match the scheduler page's *Verify Plan* / *Fix Plan* and the Schedule page's *Find replacement…* for the same data.
- [ ] 6.2 Repeat one repair with a viewer token. Verify that it is refused and that the stored result is unchanged.
- [x] 6.3 Run `make test` (backend), `cd agent && make test` and `cd e2e && make dryrun`. Verify that all pass. (Five older suites — `audit_log`, `info`, `rotation_patterns`, `shift_weekday_times`, `wish_window` — still sent unsigned tokens and failed on `main` too; they now sign with `tests/common`.)

## Workflow follow-up

- Separate change: repair keeps `published_roster` and `fixed_shifts` stable (left out of scope in proposal.md).
- Archive this change after review.
