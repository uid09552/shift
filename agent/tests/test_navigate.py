"""`navigate` knows every page of the app's main navigation."""

import asyncio
import json

from fastmcp import FastMCP

from shift_agent.mcp.server import _register_navigation


def _navigate(page: str) -> dict:
    mcp = FastMCP("test")
    _register_navigation(mcp)
    return json.loads(asyncio.run(mcp.call_tool("navigate", {"page": page})).content[0].text)


def test_the_newer_pages_resolve_to_their_routes():
    for page, path in {"changes": "/changes", "relationships": "/relationships", "analytics": "/analytics", "users": "/users"}.items():
        assert _navigate(page) == {"action": "navigate", "path": path}


def test_an_unknown_page_lists_the_valid_ones():
    error = _navigate("payroll")["error"]
    for page in ("changes", "relationships", "analytics", "users"):
        assert page in error
