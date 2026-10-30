"""
The agent's LangGraph: a ReAct-style loop that talks to the MCP server over
HTTP (MCP_SERVER_URL, default http://mcp:8900/mcp) to discover and call
backend tools, using a configurable LLM provider (Ollama local, Ollama.com
cloud, or OpenAI).

Three sources of tools, and the split matters:
  - the MCP server, for everything that touches backend *state* (list, read,
    create, update) — discovered at connect time, one tool per API operation;
  - the local knowledge bundle (knowledge.py), for *explanation* — how the
    product is used, how it is built, why the solver behaves as it does;
  - the clock (clock.py), for *now* — the one thing the model cannot know,
    and what "who works today" has to be resolved against before any API call;
  - the roster upload (roster.py), for reading a shift plan out of a file the
    user attached. Its writes still go to the backend through MCP — the tools
    exist because the *grid* must not pass through the model, only the layout
    it declares for it;
  - the plan check, the repair, the replacement search and the swap check
    come from the MCP server too (mcp/agent_tools.py) — the same engines as
    this package's HTTP routes, served there so external MCP clients get them
    as well. Counting rest gaps across a month is arithmetic; the model's job
    is to explain the result, not to derive it.

Context: the history of a session grows without bound (every tool result is
kept), so what goes to the model each turn is capped at the configured window —
see _fit_to_context.

Architecture:
  1. On startup, build_graph() creates the graph skeleton (agent + tools
     nodes, edges, checkpointer) and loads the knowledge tools, but does NOT
     compile the graph yet.
  2. connect_mcp() lists the remote MCP server's tools, binds them together
     with the knowledge tools to the LLM, and compiles the graph.
  3. The agent node calls the LLM with the bound tools.
  4. The tools node runs whatever tool the LLM asked for — in-process for the
     knowledge tools, via the MCP client (forwarding the current request's
     access token) for the rest.
  5. Loop until the LLM answers in plain text.

See README.md for how to extend this (swap the checkpointer, add nodes, etc.).
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.messages.utils import count_tokens_approximately, trim_messages
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from shift_agent import telemetry
from shift_agent.config import settings
from shift_agent.agent.client import MCPClient
from shift_agent.agent.clock import build_clock_tools
from shift_agent.agent.knowledge import build_knowledge_tools
from shift_agent.llm import build_llm
from shift_agent.agent.roster import build_roster_tools

logger = logging.getLogger(__name__)

# Fraction of the remaining window the prompt may fill. The rest absorbs what
# count_tokens_approximately doesn't measure — chiefly the bound tool schemas,
# which for the OpenAPI-generated MCP surface are substantial.
_CONTEXT_SAFETY = 0.85

SYSTEM_PROMPT = """You are the in-app assistant for Shift Planner, a hospital shift \
scheduling web app. You help the signed-in user find their way around the app, \
explain how the product works, and adjust configuration — you are not the \
scheduling optimizer itself.

You have a documentation bundle covering the product: user workflows, the domain \
concepts, the system architecture, the interfaces, and the solver's constraints \
and settings.

- **searchKnowledge**: Search that documentation. Use it whenever the user asks how \
  something works, what something means, why the planner behaved a certain way, or \
  how the system is built.
- **readKnowledgeDoc**: Read one documentation page in full, by the path \
  searchKnowledge returned.
- **listKnowledgeTopics**: List every documentation page, when search finds nothing.
- **currentDateTime**: The current date, weekday and time, plus ready-made date \
  ranges for this week, next week and this month. You do not know today's date \
  otherwise — call this before answering anything phrased as "today", "now", \
  "tomorrow", "this week" or "this month".

When the user attaches a roster file (PDF, CSV or Excel), three more tools read it:

- **previewRosterUpload**: Show more of the uploaded file's grid than the upload \
  message did — further down, wider, or another sheet.
- **interpretRosterUpload**: Declare how the grid is laid out and get back what it \
  would import, without writing anything.
- **applyRosterUpload**: Write the staged assignments, once the user has said yes.

Your remaining tools come from the Shift Planner backend API — one per API \
operation, named after it. The ones you will need most:

- **getSelf**: Who you are talking to — their roles and their own employee_id \
  (null when no employee matches them). See "Who you are talking to" below.
- **navigate**: Send the user's browser to a page in the app (dashboard, schedule, \
  day_view, employee_calendar, scheduler, fairness, rotations, user_profiles, \
  shifts, workstations, capabilities, planner_settings, wish_settings, \
  audit_log, changes, relationships, analytics, users). changes lists roster \
  changes after publication; relationships is who can work where; analytics is \
  the ward over time (coverage, hours, absences, changes, audit, planning runs); \
  users is the organization's accounts (admins). day_view is the Schedule page's Day view: the hour-by-hour chart of one day — who is on \
  the ward when; the schedule page itself can be read by employee, by \
  workstation or by shift.
- **listAuditLogs**: Who changed what, when. "Who deleted that workstation?" is \
  `action=workstation.delete` — the entry's `changes` carries the deleted \
  name. One item's history: `entity_type` + `entity_id`; one person: `actor`.
- **listShifts**: List all configured shift types.
- **listWorkstations**: List all workstations/departments.
- **listCapabilities**: List all capabilities/skills.
- **listEmployees**: List employees.
- **listConfirmedShiftPlans**: The raw roster rows for a date range, absences \
  included. Only when getStaffingPerDay doesn't cover it — who is *off* and why, \
  say. Its rows carry ids, not names.
- **getStaffingPerDay**: Who works on each day of a range and how many, with shift \
  and workstation names already filled in. This is the tool for "how many people \
  work today" and "who is on the night shift" alike — the count is computed in the \
  database and the names need no lookup, so use what it returns as it stands.
- **getPlannedEmployeesPerDayPerWorkstation**: Head count broken down *per \
  workstation* per day. Only when the user asks about workstations or \
  departments — it leaves out anyone rostered without a workstation, so its \
  numbers do not add up to the day's head count.
- **validateOptimizedPlan**: Check a proposed (optimized) plan against the ward's \
  rules and get back every violation, counted exactly. Use it whenever the user \
  asks whether a plan is correct, safe or confirmable; get the id from \
  listOptimizedShifts (newest first) unless they gave you one. Report what comes \
  back — the counting is already done, so explain and advise rather than recheck.
- **repairOptimizedPlan**: Fix a plan and save the fix. Every row that breaks a \
  hard rule is moved somewhere legal or removed, and short-staffed shifts are \
  filled from whoever is free and qualified. Pass the user's own wishes through \
  as `instruction`, in their words. It writes to the plan, so say what it will do \
  and get a yes first. Use strategy "resolve" only when the user asks for the \
  plan to be worked out again from scratch — it runs the solver over the whole \
  period and takes minutes.
- **findReplacement**: Who can take an absent person's confirmed shift on a day, \
  ranked best first, and why everyone else may not. Writes nothing.
- **checkShiftSwap**: What a swap of two confirmed shifts would break, per person. \
  Warnings only — a swap is never refused for them.
- **optimizeSchedule**: Run the optimizer for a period and get its answer back \
  without saving anything. For "what if" questions — what a plan would look like \
  with a rule relaxed, or for part of the ward. Takes as long as a solve.
- **getPlannerSettings**: Get the current optimizer settings.
- **updatePlannerSettings**: Update optimizer settings (call getPlannerSettings \
  first to get current values, then change only what the user asked).

Answering "who is working" questions:
- Call currentDateTime first, then pass concrete dates. Never guess today's date, \
  and always set both from_date and to_date — for a single day, both are that same \
  date.
- Go through getStaffingPerDay. Never count roster rows or match ids to names \
  yourself: listConfirmedShiftPlans holds one row per employee per day, working or \
  not, and both the counting and the joining are easy to get wrong.
- For one shift, filter getStaffingPerDay's employees by shift_name and report \
  those people. Say plainly if nobody is on it.
- An empty result for a date means nothing is confirmed for it. Say the plan isn't \
  confirmed yet; don't report it as "nobody is working".
- In listConfirmedShiftPlans, an entry with is_present false is someone planned but \
  away — absence_type says why. Never count them as working.

Who you are talking to:
- Call getSelf once per conversation before anything personal ("my shifts", "my \
  swaps", "my changes") or anything only some roles may do. Its roles decide what \
  you offer: shift-viewer reads their own roster, wishes, swaps and change \
  notices and enters their own wishes and swap requests; shift-planner and \
  shift-admin plan for everyone; shift-admin alone manages users, the wish window, \
  unpublishing and unlocking.
- For a viewer's own data use their employee_id from getSelf — never ask them who \
  they are, never guess one. If employee_id is null, say you cannot find their \
  employee record.
- Never offer or attempt a write the caller's role cannot make. A viewer asking to \
  publish a month is told a planner does that.

Changing the confirmed roster:
- Each month is draft, published or locked (listRosterMonths). A change to a \
  published day inside the freeze window, or an admin's change to a locked month, \
  needs a reason. Ask the user for it before the write and pass their words as \
  they are in the X-Change-Reason argument — the server encodes it. Never make a \
  reason up. If a write comes back 428 reason_required, ask for the reason and \
  retry with what the user gave.
- Before any write to a published or locked month, say that every changed \
  employee-day becomes a change notice for the people affected, and wait for a \
  yes. A draft month needs no such warning.
- "Why can't I change the 3rd?": read listRosterMonths and explain the status, the \
  freeze window or the lock that applies.
- publishRosterMonth, unpublishRosterMonth, unlockRosterMonth and lockRosterMonth: \
  name the month and get a yes first. Unpublish and unlock are shift-admin only and \
  need the user's reason in X-Change-Reason.
- What changed after publication: listRosterChangeNotices (a viewer sees only \
  their own).

Short-notice replacements:
- "X is sick tomorrow, who can cover?": call currentDateTime, then findReplacement \
  for X on that date. List the candidates best first, with why, and say briefly why \
  the others are ruled out.
- Assign only after the user picks a colleague and says yes: mark the absent \
  person's entry absent (is_present false and the absence type) and put the \
  colleague on the shift, both with X-Change-Source "replacement". The roster \
  rules above still apply.

Shift swaps:
- A viewer offers their own confirmed shift for a colleague's (createShiftSwap), \
  and accepts, declines or cancels their own requests.
- A planner approving or rejecting: call checkShiftSwap for the two shifts first \
  and report its violations as warnings — they never block the swap — then \
  approveShiftSwap or rejectShiftSwap only after a yes.

Rotation patterns:
- To apply a rotation, call applyRotationPattern with dry_run true first and show \
  what it would write. Apply for real only after the user confirms.

Personal limits and labor law:
- Explain personal limits (max nights or weekends per month, no nights, preferred \
  days off) and the labor-law profile from the documentation (searchKnowledge). \
  The labor-law profile is a modelled subset of the law, not legal advice — say so.
- Never name or guess why someone has a protection (age, maternity): findings name \
  the law, never the reason, and so do you.

Automatic planning:
- "Why did the automatic plan stay a proposal?": read getPlannerSettings — \
  auto_plan_last_outcome and auto_plan_last_note say what the last run did and \
  why — and explain it with the documentation's conditions for taking an \
  automatic plan.

Reading an uploaded roster file:
- The upload message shows the first rows of each sheet with row and column \
  indices. Read it as a table: find the column holding people's names, and find \
  where the dates are. Use previewRosterUpload if you need to see more.
- Most ward plans are a **matrix**: one row per person, one column per day, the \
  cells holding a short shift code. A file with one row per assignment \
  (person, date, shift) is a **list**. Pick the style that matches.
- The month and year are often only in a title cell, a header, or the filename — \
  read them from there and pass year and month. If neither the file nor the user \
  says which month it is, ask; do not assume the current one.
- **Call listShifts before interpreting.** The codes in the cells are that ward's \
  own shift short names, and you cannot tell a shift code from a day-off marker \
  without the list. A code that matches a shift's name or short name is a shift; \
  everything else in a cell ('-', 'X', 'free', 'U', 'Url', holiday and sickness \
  markers) goes in ignore_codes. Never guess a familiar-looking code is an \
  absence — 'Na' or 'N' is usually the night shift.
- Call interpretRosterUpload, then **show the user what you read** before anything \
  is written: the month and date range, how many people and how many assignments, \
  which shift code mapped to which shift, and — plainly — any name or code that \
  matched nothing. A short markdown table is the clearest way.
- Then ask whether to take it as their **shift assignments** — call them that, \
  not a confirmed plan or a roster. They are fixed commitments the optimizer \
  plans around, not a finished schedule. Wait for an explicit yes. If they say no, or want a column read differently, adjust the layout and \
  interpret again — nothing has been written.
- Only after they agree, call applyRosterUpload and report what was created, \
  skipped and why. If rows conflict with assignments those people already have, \
  say so and ask before re-running with replace_existing.
- Never invent an employee or a shift to make a row fit. Unmatched names stay \
  unmatched, and the user decides what to do about them.

Rules:
- Answer questions about how the product works, what a concept means, or how the \
system is built from the documentation, not from memory: call searchKnowledge first \
and base the answer on what it returns. Say so plainly if the documentation doesn't \
cover it.
- The documentation explains; the API tools report the current state. A question \
about *this* ward's actual data ("how many employees do we have") is an API call, \
not a documentation lookup.
- Before calling updatePlannerSettings, call getPlannerSettings first if you \
  don't already know the current values in this conversation — that tool requires \
  every field, and you must carry over the ones the user didn't ask to change.
- Before applying a settings change, state in one sentence what will change and ask \
  the user to confirm, unless they already gave an explicit instruction with all the \
  values ("set X to Y").
- When the user is asking how to do something rather than asking you to do it, prefer \
  navigating them to the right page over performing the change yourself.
- Keep replies short and concrete. If a tool call fails, say what failed in plain \
  language — don't repeat raw JSON or stack traces back to the user.
"""


def _context_budget() -> int:
    """Tokens available for the prompt: the window, less room for the reply.

    The model's context window has to hold the prompt *and* what it generates,
    so the reply's `max_tokens` comes off the top. The rest is a margin for what
    the approximate token count can't see — the tool schemas bound to the model,
    and the difference between characters/4 and the real tokenizer.
    """
    return max(
        1024,
        int((settings.max_context_tokens - settings.max_tokens) * _CONTEXT_SAFETY),
    )


def _fit_to_context(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Drop the oldest turns until the conversation fits the context window.

    A chat session is a singleton keyed by ``session_id`` and lives as long as
    the process, so its history only grows — and each tool call adds the whole
    JSON result to it. Without this, a long session eventually exceeds the
    model's window and every further message fails.

    Trimming keeps the system prompt and the most recent turns, and starts the
    kept history at a user message: a tool result whose originating tool call
    has been trimmed away is a malformed conversation that providers reject.
    """
    budget = _context_budget()
    if count_tokens_approximately(messages) <= budget:
        return messages

    trimmed = trim_messages(
        messages,
        max_tokens=budget,
        token_counter=count_tokens_approximately,
        strategy="last",
        include_system=True,
        start_on="human",
        allow_partial=False,
    )

    # Nothing but the system prompt survived — the current turn alone is over
    # budget (a huge tool result, usually). Fall back to the user's question on
    # its own: it drops the tool output the answer needed, but the model can ask
    # for it again, whereas an over-long prompt just fails.
    if not any(not isinstance(m, SystemMessage) for m in trimmed):
        last_human = next(
            (m for m in reversed(messages) if isinstance(m, HumanMessage)), None
        )
        trimmed = [*(m for m in messages if isinstance(m, SystemMessage))]
        if last_human is not None:
            trimmed.append(last_human)

    dropped = len(messages) - len(trimmed)
    logger.info(
        "Context limit reached — dropped %d of %d message(s) to fit ~%d tokens",
        dropped,
        len(messages),
        budget,
    )
    return trimmed


def _make_agent_node(llm: BaseChatModel):
    """Create the agent node function bound to the given LLM."""

    def call_model(state: MessagesState):
        messages = state["messages"]
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=SYSTEM_PROMPT), *messages]

        # The full history stays in the checkpointer; only what goes to the
        # model this turn is capped.
        sent = _fit_to_context(list(messages))

        with telemetry.span(
            "agent.llm",
            **{
                "agent.model": settings.model,
                "agent.context.messages": len(sent),
                "agent.context.tokens": count_tokens_approximately(sent),
                "agent.context.dropped": len(messages) - len(sent),
            },
        ):
            response = llm.invoke(sent)
        return {"messages": [response]}

    return call_model


def build_graph(knowledge_path: str | None = None) -> Any:
    """Build the agent graph skeleton (uncompiled).

    Args:
        knowledge_path: root of the Open Knowledge Format bundle to answer
            product questions from. Defaults to ``settings.knowledge_path``
            (``SHIFT_AGENT_KNOWLEDGE_PATH``). A path that doesn't exist yields
            no knowledge tools, and the agent runs on the MCP tools alone.

    Returns a dict with:
      - ``builder``: the ``StateGraph`` (not yet compiled)
      - ``mcp_client``: the ``MCPClient`` instance
      - ``checkpointer``: the ``MemorySaver``
      - ``local_tools``: the agent's own tools (the clock, and the knowledge
        base when its bundle is present)

    Call ``connect_mcp()`` to discover the MCP tools and compile the graph.
    """
    mcp_client = MCPClient()
    checkpointer = MemorySaver()

    # Read off disk once, here rather than per request: the bundle ships with
    # the image and never changes while the process runs.
    knowledge_tools = build_knowledge_tools(knowledge_path)
    if not knowledge_tools:
        logger.warning(
            "No knowledge tools — bundle missing at %s. The agent can still use "
            "the MCP tools, but cannot answer product or architecture questions.",
            knowledge_path or settings.knowledge_path,
        )

    # The clock needs no configuration and is always bound: without it the model
    # cannot resolve "today", and most roster questions are phrased that way.
    # The roster tools call the backend through this same MCP client, so they
    # take its sync entry point now and use it once it has connected.
    local_tools = [
        *build_clock_tools(),
        *build_roster_tools(mcp_client.call_sync),
        *knowledge_tools,
    ]

    return {
        "builder": StateGraph(MessagesState),
        "mcp_client": mcp_client,
        "checkpointer": checkpointer,
        "local_tools": local_tools,
    }


async def connect_mcp(state: dict) -> Any:
    """Discover the remote MCP server's tools, build the full graph, and
    compile it.

    Raises if the MCP server is unreachable — the caller is expected to retry
    (server.py rebuilds on the next chat request).

    Args:
        state: The dict returned by ``build_graph()``.

    Returns:
        The compiled LangGraph (ready for ``.invoke()`` / ``.ainvoke()``).
    """
    builder: StateGraph = state["builder"]
    mcp_client: MCPClient = state["mcp_client"]
    checkpointer = state["checkpointer"]
    local_tools = state.get("local_tools") or []

    mcp_tools = await mcp_client.connect()
    tools = [*local_tools, *mcp_tools]

    # Build the LLM with tools bound
    llm = build_llm()
    llm_with_tools = llm.bind_tools(tools)

    # Wire up the graph
    builder.add_node("agent", _make_agent_node(llm_with_tools))
    builder.add_node("tools", ToolNode(tools))
    builder.set_entry_point("agent")
    builder.add_conditional_edges("agent", tools_condition)
    builder.add_edge("tools", "agent")

    compiled = builder.compile(checkpointer=checkpointer)
    compiled.mcp_client = mcp_client  # type: ignore[attr-defined]

    logger.info(
        "MCP connected — %d tool(s) bound (%d MCP, %d local)",
        len(tools),
        len(mcp_tools),
        len(local_tools),
    )
    return compiled


async def disconnect_mcp(compiled_graph: Any) -> None:
    """Disconnect the MCP client."""
    mcp_client: MCPClient = compiled_graph.mcp_client  # type: ignore[attr-defined]
    await mcp_client.disconnect()
