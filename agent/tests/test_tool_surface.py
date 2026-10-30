"""What the MCP server offers beyond the backend's own operations."""

import asyncio

import httpx
from fastmcp import FastMCP

from shift_agent.mcp.agent_tools import register_agent_tools
from shift_agent.mcp.server import _load_openapi_spec, _register_navigation, _register_optimizer


def test_the_server_offers_who_am_i_and_the_agents_tools():
    mcp = FastMCP.from_openapi(openapi_spec=_load_openapi_spec(), client=httpx.AsyncClient(base_url="http://backend"))
    _register_navigation(mcp)
    _register_optimizer(mcp)
    register_agent_tools(mcp, llm_provider=lambda: None)
    names = {t.name for t in asyncio.run(mcp.list_tools())}
    for name in ("getSelf", "validateOptimizedPlan", "repairOptimizedPlan", "findReplacement", "checkShiftSwap", "navigate", "optimizeSchedule"):
        assert name in names, name
