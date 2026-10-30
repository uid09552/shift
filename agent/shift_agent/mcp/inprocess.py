"""
Running the agent's rule engines inside the MCP server.

The plan check, the repair, the replacement search and the swap check
(agent/validation.py, repair.py, replacement.py) are synchronous and reach the
backend only through a ``call_mcp(tool_name, arguments) -> str`` callable. In
the chat agent that callable goes over HTTP to this server; here it calls the
server's own generated tools directly, in process.

FastMCP 4's public ``FastMCP.call_tool(name, arguments)`` runs a registered
tool by name (middleware included), so no private registry is touched.

Two hops, and the token survives both explicitly rather than by luck:

  MCP request (caller's token)
    -> tool coroutine: token resolved here, on the request's own context
    -> engine in a worker thread (anyio.to_thread)
         call_mcp(name, args)
           -> back on the server's loop (anyio.from_thread)
                acting_as(token): generated tool -> backend

so every backend call the engine makes runs as the MCP caller — never as the
static fallback token when the caller presented one of their own.
"""

from __future__ import annotations

import json
import logging
from typing import Callable, TypeVar

import anyio
import anyio.from_thread
import anyio.to_thread
from fastmcp import FastMCP

from shift_agent.mcp.auth import acting_as, get_access_token

logger = logging.getLogger(__name__)

T = TypeVar("T")

CallMCP = Callable[[str, dict], str]


def _as_json(text: str) -> str:
    """Pretty-print a JSON string, as the chat agent's MCP client returns it."""
    try:
        return json.dumps(json.loads(text), indent=2)
    except (json.JSONDecodeError, TypeError):
        return text


class InProcessTools:
    """Hands engines a ``call_mcp`` bound to this server's own tools."""

    def __init__(self, mcp: FastMCP) -> None:
        self._mcp = mcp

    async def run(self, engine: Callable[[CallMCP], T]) -> T:
        """Run a synchronous ``engine(call_mcp)`` in a worker thread, every
        backend call it makes carrying the current request's token."""
        token = get_access_token()

        def call_mcp(name: str, arguments: dict) -> str:
            return anyio.from_thread.run(self._call, name, arguments, token)

        return await anyio.to_thread.run_sync(engine, call_mcp)

    async def _call(self, name: str, arguments: dict, token: str | None) -> str:
        """One tool call, answered the way agent/client.py's ``call_sync``
        answers it: the tool's text, or ``{"error": …}``."""
        with acting_as(token):
            try:
                result = await self._mcp.call_tool(name, arguments)
            except Exception as exc:  # ToolError, NotFoundError, ValidationError
                logger.warning("In-process tool '%s' failed: %s", name, exc)
                return json.dumps({"error": str(exc)})
        if result.content:
            return _as_json(getattr(result.content[0], "text", ""))
        return json.dumps({"result": "ok"})
