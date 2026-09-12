"""
MCP client — connects the LangGraph agent to the MCP server (shift_agent.mcp)
over streamable HTTP so the agent discovers and calls backend tools through
FastMCP instead of hard-coding them.

The server is a remote process (``MCP_SERVER_URL``, default
``http://mcp:8900/mcp`` — the "mcp" service in deploy/docker-compose.yml), not
an in-process import: the agent holds no backend code of its own, and the MCP
server can be scaled, restarted and shared with external MCP clients
independently.

Auth: the token that ends up on the backend call is whichever one the caller
presented, so every tool call opens its own short-lived session carrying the
current chat request's token (agent/auth.py's ``get_outgoing_token()``: the forwarded
X-Access-Token / Authorization bearer, else the static BACKEND_ACCESS_TOKEN)
as an ``Authorization: Bearer`` header. One long-lived session can't serve
this — its headers are fixed at connect time, while the graph and its MCP
client are a process-wide singleton shared by every user's request.

Usage:
    client = MCPClient()
    tools = await client.connect()
    # tools is a list of LangChain StructuredTool objects
    ...
    await client.disconnect()
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from langchain_core.tools import StructuredTool

from shift_agent import telemetry
from shift_agent.agent.auth import get_outgoing_token
from shift_agent.config import settings

logger = logging.getLogger(__name__)


# Tools that run the solver rather than reading the database, and so need the
# long timeout instead of the per-call one. Everything else answers in
# milliseconds; these are bounded by the optimizer's own time limit.
LONG_RUNNING_TOOLS = {"optimizeSchedule"}


def _as_json(text: str) -> str:
    """Try to pretty-print a JSON string; return as-is on failure."""
    try:
        parsed = json.loads(text)
        return json.dumps(parsed, indent=2)
    except (json.JSONDecodeError, TypeError):
        return text


class MCPClient:
    """Exposes a remote MCP server's tools as LangChain StructuredTool objects
    usable by the LangGraph agent."""

    def __init__(self, url: str | None = None) -> None:
        self._url = url or settings.mcp_server_url
        self._tools: list[StructuredTool] = []
        self._connected = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def connect(self) -> list[StructuredTool]:
        """Discover the MCP server's tools and return them as LangChain
        StructuredTool objects.

        Runs one throwaway session against the server; the actual tool calls
        open their own (see ``_call_tool``). Raises if the server can't be
        reached, so the caller can retry on the next request.
        """
        async with self._session(get_outgoing_token()) as session:
            mcp_tools = await session.list_tools()

        allowlist = settings.mcp_tools
        if allowlist:
            selected = [t for t in mcp_tools if t.name in allowlist]
            missing = sorted(set(allowlist) - {t.name for t in selected})
            if missing:
                logger.warning(
                    "MCP_TOOLS names not exposed by %s: %s",
                    self._url,
                    ", ".join(missing),
                )
        else:
            selected = list(mcp_tools)

        self._tools = [self._mcp_to_langchain_tool(t) for t in selected]
        self._connected = True

        logger.info(
            "MCP client ready (%s) — %d of %d tool(s) selected",
            self._url,
            len(self._tools),
            len(mcp_tools),
        )
        return self._tools

    async def disconnect(self) -> None:
        """No persistent connection to tear down — each call opens and closes
        its own session — kept for symmetry with the graph's
        build/connect/disconnect lifecycle."""
        self._connected = False
        self._tools = []
        logger.info("MCP client disconnected")

    @property
    def tools(self) -> list[StructuredTool]:
        """Discovered LangChain tools (empty until connect() is called)."""
        return list(self._tools)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _session(self, token: str | None, tool_name: str | None = None) -> Client:
        """A FastMCP client for one session, authenticated as ``token``.

        The timeout is per session, and a session is per call, so a tool that
        runs a solve gets the long one without slowing down the failure of
        everything else.
        """
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        timeout = (
            settings.mcp_long_timeout_seconds
            if tool_name in LONG_RUNNING_TOOLS
            else settings.mcp_timeout_seconds
        )
        return Client(
            StreamableHttpTransport(self._url, headers=headers),
            timeout=timeout,
        )

    def _mcp_to_langchain_tool(self, mcp_tool: Any) -> StructuredTool:
        """Wrap a single MCP tool as a LangChain StructuredTool.

        Both sync and async call paths are provided so the tool works with
        LangGraph's ToolNode regardless of whether the graph is invoked with
        ``.invoke()`` (sync) or ``.ainvoke()`` (async).

        The sync path delegates to ``call_sync``, which resolves the access
        token and trace context on the caller's stack before hopping threads.
        """
        tool_name: str = mcp_tool.name
        tool_description: str = mcp_tool.description or ""
        input_schema: dict = mcp_tool.inputSchema

        async def async_call(**kwargs: Any) -> str:
            return await self._call_tool(tool_name, kwargs, get_outgoing_token())

        def sync_call(**kwargs: Any) -> str:
            return self.call_sync(tool_name, kwargs)

        return StructuredTool(
            name=tool_name,
            description=tool_description,
            args_schema=input_schema,
            func=sync_call,
            coroutine=async_call,
        )

    def call_sync(self, name: str, arguments: dict[str, Any]) -> str:
        """Call an MCP tool from synchronous code, and return its text result.

        Used both by the wrapped StructuredTools above and by the agent's own
        local tools that need a backend operation without the model in the loop
        — the roster upload, which sends hundreds of parsed rows to
        ``importShiftAssignments`` (see agent/roster.py). Those still go through
        MCP like every other backend call; they just aren't the model's own tool
        choice.

        The access token and trace context are resolved here, on the caller's
        stack, and passed down explicitly: the sync path hops threads and event
        loops, which the contextvars they come from would not survive.
        """
        token = get_outgoing_token()
        trace_context = telemetry.current_context()

        async def run() -> str:
            with telemetry.use_context(trace_context):
                return await self._call_tool(name, arguments, token)

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            # No running loop (the usual case — a Flask request thread).
            return asyncio.run(run())

        # Called from inside a running loop: asyncio.run() would fail, so run
        # it to completion on a worker thread of its own instead.
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, run()).result()

    async def _call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        token: str | None,
    ) -> str:
        """Call a tool on the MCP server as ``token`` and return its text
        result."""
        started = time.perf_counter()
        with telemetry.tool_span(name, **{"server.address": self._url}) as span:
            try:
                async with self._session(token, name) as session:
                    result = await session.call_tool(name, arguments, raise_on_error=False)
            except Exception as exc:
                logger.exception("MCP tool '%s' call failed", name)
                telemetry.set_attributes(span, **{"error.type": type(exc).__name__})
                telemetry.record_tool_call(time.perf_counter() - started, name, "unreachable")
                return json.dumps({"error": f"MCP call failed: {exc}"})

            outcome = "error" if result.is_error else "ok"
            telemetry.set_attributes(span, **{"mcp.tool.is_error": result.is_error})
            telemetry.record_tool_call(time.perf_counter() - started, name, outcome)

            if result.is_error:
                error_text = (
                    result.content[0].text
                    if result.content
                    else "Unknown MCP error"
                )
                return json.dumps({"error": error_text})

            if result.content:
                return _as_json(result.content[0].text)

            return json.dumps({"result": "ok"})
