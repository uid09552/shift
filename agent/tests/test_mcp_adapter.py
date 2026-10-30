"""The MCP server runs the agent's rule engines in process (mcp/inprocess.py):
generated tools are called by name, and every backend call carries the MCP
caller's token — the static fallback only when the caller presented none."""

import asyncio
import dataclasses
import json

import httpx
import pytest
from fastmcp import FastMCP

from shift_agent.config import settings
from shift_agent.mcp import auth
from shift_agent.mcp.auth import BackendTokenAuth, acting_as
from shift_agent.mcp.inprocess import InProcessTools

SPEC = {
    "openapi": "3.0.0",
    "info": {"title": "test", "version": "1"},
    "paths": {
        "/things/{id}": {
            "get": {
                "operationId": "getThing",
                "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
                "responses": {"200": {"description": "ok", "content": {"application/json": {"schema": {"type": "object"}}}}},
            }
        }
    },
}


@pytest.fixture
def backend(monkeypatch):
    """A generated MCP server over a mocked backend that records each request's token."""
    # Settings are frozen; swap the copy auth.py reads.
    monkeypatch.setattr(auth, "settings", dataclasses.replace(settings, backend_access_token="static-token"))
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("x-access-token"))
        if request.url.path.endswith("/missing"):
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json={"id": request.url.path.rsplit("/", 1)[-1]})

    client = httpx.AsyncClient(base_url="http://backend", transport=httpx.MockTransport(handler), auth=BackendTokenAuth())
    return FastMCP.from_openapi(openapi_spec=SPEC, client=client), seen


def test_a_generated_tool_runs_in_process_by_name(backend):
    mcp, _ = backend
    result = asyncio.run(mcp.call_tool("getThing", {"id": "42"}))
    assert json.loads(result.content[0].text) == {"id": "42"}


def test_a_pinned_token_is_what_the_backend_sees(backend):
    mcp, seen = backend

    async def call():
        with acting_as("user-token"):
            await mcp.call_tool("getThing", {"id": "1"})
        await mcp.call_tool("getThing", {"id": "2"})

    asyncio.run(call())
    assert seen == ["user-token", "static-token"], "pinned while set, the fallback only after"


def test_every_call_of_an_engine_carries_the_outer_token(backend):
    mcp, seen = backend
    tools = InProcessTools(mcp)

    def engine(call_mcp):
        return [json.loads(call_mcp("getThing", {"id": str(i)}))["id"] for i in range(3)]

    async def as_caller():
        with acting_as("outer-token"):
            return await tools.run(engine)

    assert asyncio.run(as_caller()) == ["0", "1", "2"]
    assert seen == ["outer-token"] * 3


def test_without_a_caller_token_the_engine_uses_the_static_fallback(backend):
    mcp, seen = backend
    asyncio.run(InProcessTools(mcp).run(lambda call_mcp: call_mcp("getThing", {"id": "x"})))
    assert seen == ["static-token"]


def test_a_failing_tool_answers_with_an_error_like_the_chat_client(backend):
    mcp, _ = backend
    answer = asyncio.run(InProcessTools(mcp).run(lambda call_mcp: call_mcp("getThing", {"id": "missing"})))
    assert "error" in json.loads(answer)
