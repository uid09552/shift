"""
The agent's LangGraph: a ReAct-style loop that talks to the MCP server over
HTTP (MCP_SERVER_URL, default http://mcp:8900/mcp) to discover and call
backend tools, using a configurable LLM provider (Ollama local, Ollama.com
cloud, or OpenAI).

Two sources of tools, and the split matters:
  - the MCP server, for everything that touches backend *state* (list, read,
    create, update) — discovered at connect time, one tool per API operation;
  - the local knowledge bundle (knowledge.py), for *explanation* — how the
    product is used, how it is built, why the solver behaves as it does.

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
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from shift_agent.config import settings
from shift_agent.agent.client import MCPClient
from shift_agent.agent.knowledge import build_knowledge_tools

logger = logging.getLogger(__name__)

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

Your remaining tools come from the Shift Planner backend API — one per API \
operation, named after it. The ones you will need most:

- **navigate**: Send the user's browser to a page in the app (dashboard, schedule, \
  employee_calendar, workstation_calendar, scheduler, user_profiles, shifts, \
  workstations, capabilities, planner_settings).
- **listShifts**: List all configured shift types.
- **listWorkstations**: List all workstations/departments.
- **listCapabilities**: List all capabilities/skills.
- **listEmployees**: List employees.
- **getPlannerSettings**: Get the current optimizer settings.
- **updatePlannerSettings**: Update optimizer settings (call getPlannerSettings \
  first to get current values, then change only what the user asked).

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


def _build_llm() -> BaseChatModel:
    """Build the chat model based on the configured provider."""
    provider = settings.llm_provider

    if provider == "ollama":
        logger.info(
            "Using Ollama (local): %s, model=%s",
            settings.ollama_base_url,
            settings.model,
        )
        return ChatOpenAI(
            model=settings.model,
            base_url=f"{settings.ollama_base_url}/v1",
            api_key="ollama",
            max_tokens=settings.max_tokens,
            temperature=settings.temperature,
        )

    elif provider == "ollama-com":
        api_key = settings.ollama_com_api_key
        if not api_key:
            raise ValueError(
                "OLLAMA_COM_API_KEY is required when SHIFT_AGENT_LLM_PROVIDER=ollama-com"
            )
        logger.info("Using Ollama.com cloud: model=%s", settings.model)
        return ChatOpenAI(
            model=settings.model,
            base_url=f"{settings.ollama_com_base_url}/v1",
            api_key=api_key,
            max_tokens=settings.max_tokens,
            temperature=settings.temperature,
        )

    elif provider == "openai":
        logger.info("Using OpenAI: model=%s", settings.model)
        return ChatOpenAI(
            model=settings.model,
            max_tokens=settings.max_tokens,
            temperature=settings.temperature,
        )

    else:
        raise ValueError(
            f"Unknown LLM provider '{provider}'. "
            f"Expected one of: ollama, ollama-com, openai"
        )


def _make_agent_node(llm: BaseChatModel):
    """Create the agent node function bound to the given LLM."""

    def call_model(state: MessagesState):
        messages = state["messages"]
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=SYSTEM_PROMPT), *messages]
        response = llm.invoke(messages)
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
      - ``local_tools``: the agent's own tools (knowledge base)

    Call ``connect_mcp()`` to discover the MCP tools and compile the graph.
    """
    mcp_client = MCPClient()
    checkpointer = MemorySaver()

    # Read off disk once, here rather than per request: the bundle ships with
    # the image and never changes while the process runs.
    local_tools = build_knowledge_tools(knowledge_path)
    if not local_tools:
        logger.warning(
            "No knowledge tools — bundle missing at %s. The agent can still use "
            "the MCP tools, but cannot answer product or architecture questions.",
            knowledge_path or settings.knowledge_path,
        )

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
    llm = _build_llm()
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
        "MCP connected — %d tool(s) bound (%d MCP, %d knowledge)",
        len(tools),
        len(mcp_tools),
        len(local_tools),
    )
    return compiled


async def disconnect_mcp(compiled_graph: Any) -> None:
    """Disconnect the MCP client."""
    mcp_client: MCPClient = compiled_graph.mcp_client  # type: ignore[attr-defined]
    await mcp_client.disconnect()
