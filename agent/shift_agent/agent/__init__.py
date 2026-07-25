"""
The chat agent: the LangGraph ReAct loop (graph.py), the MCP client it gets
its tools from (client.py), the Flask API the website talks to (server.py),
and their auth (auth.py).

It owns no backend code — every tool it can call comes from the MCP server
(shift_agent.mcp), reached over HTTP. The only thing crossing between the two
packages is an access token, on the wire.
"""

from shift_agent.agent.graph import build_graph, connect_mcp, disconnect_mcp
from shift_agent.agent.server import create_app

__all__ = ["build_graph", "connect_mcp", "disconnect_mcp", "create_app"]
