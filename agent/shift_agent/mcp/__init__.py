"""
The MCP server: the Rust backend's REST API exposed as MCP tools (server.py),
and the auth that decides which access token those backend calls carry
(auth.py).

Runs as its own process (`shift-agent mcp`), serving the chat agent
(shift_agent.agent) and any external MCP client alike.
"""

from shift_agent.mcp.server import build_mcp_server, get_mcp

__all__ = ["build_mcp_server", "get_mcp"]
