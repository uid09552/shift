"""A roster write's reason goes to the backend URL-encoded (X-Change-Reason),
whatever form the caller passed it in — the MCP server encodes it, so the
model can pass the planner's words verbatim."""

import asyncio
import json

import httpx
import pytest
from fastmcp import FastMCP

from shift_agent.mcp.auth import BackendTokenAuth
from shift_agent.mcp.server import CHANGE_REASON_ARG, ChangeReasonMiddleware, _load_openapi_spec, encode_change_reason

ENCODED = "Krankmeldung%20M%C3%BCller"


@pytest.fixture
def server():
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("x-change-reason"))
        return httpx.Response(200, json={"month": "2026-11", "status": "draft"})

    client = httpx.AsyncClient(base_url="http://backend/api/v1", transport=httpx.MockTransport(handler), auth=BackendTokenAuth())
    mcp = FastMCP.from_openapi(openapi_spec=_load_openapi_spec(), client=client)
    mcp.add_middleware(ChangeReasonMiddleware())
    return mcp, seen


def test_the_generated_roster_tools_take_the_reason_under_its_header_name(server):
    mcp, _ = server
    tool = asyncio.run(mcp.get_tool("unpublishRosterMonth"))
    assert CHANGE_REASON_ARG in tool.parameters["properties"]


@pytest.mark.parametrize("given", ["Krankmeldung Müller", ENCODED])
def test_raw_and_already_encoded_reasons_arrive_encoded(server, given):
    mcp, seen = server
    result = asyncio.run(mcp.call_tool("unpublishRosterMonth", {"month": "2026-11", CHANGE_REASON_ARG: given}))
    assert json.loads(result.content[0].text)["month"] == "2026-11"
    assert seen == [ENCODED]


def test_encoding_is_idempotent():
    assert encode_change_reason(encode_change_reason("a/b & c")) == encode_change_reason("a/b & c")
