"""
The agent's LangGraph: a minimal ReAct-style loop — call the model, run any
tools it asks for, feed the results back, repeat until it answers in plain
text. See README.md for how to extend this (add tools, add nodes, swap the
checkpointer for a persistent store).
"""

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from shift_agent.config import settings
from shift_agent.tools import ALL_TOOLS

SYSTEM_PROMPT = """You are the in-app assistant for Shift Planner, a hospital shift \
scheduling web app. You help the signed-in user find their way around the app and \
adjust configuration — you are not the scheduling optimizer itself.

You can:
- Send the user to a page with the `navigate` tool.
- Look up shifts, workstations, capabilities, employees, and the planner's \
  optimizer settings with the list_* / get_planner_settings tools.
- Change the optimizer settings with update_planner_settings.

Rules:
- Before calling update_planner_settings, call get_planner_settings first if you \
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


def build_graph():
    """Compile the agent graph. Call once per process; reuse the returned graph."""
    llm = ChatOpenAI(model=settings.model, max_tokens=settings.max_tokens)
    llm_with_tools = llm.bind_tools(ALL_TOOLS)

    def call_model(state: MessagesState):
        messages = state["messages"]
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=SYSTEM_PROMPT), *messages]
        response = llm_with_tools.invoke(messages)
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("agent", call_model)
    graph.add_node("tools", ToolNode(ALL_TOOLS))
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", tools_condition)
    graph.add_edge("tools", "agent")

    # In-memory checkpointer: conversation history survives for the life of the
    # process, keyed by thread_id (see server.py's session_id). Swap for
    # langgraph's SqliteSaver/PostgresSaver to persist across restarts.
    checkpointer = MemorySaver()
    return graph.compile(checkpointer=checkpointer)
