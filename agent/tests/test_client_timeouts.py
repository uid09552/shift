"""Calls that run a solve get the long MCP timeout; everything else the short one."""

from shift_agent.agent import client as client_module
from shift_agent.agent.client import MCPClient
from shift_agent.config import settings


def _timeout_for(monkeypatch, tool: str) -> float:
    captured = {}

    class FakeClient:
        def __init__(self, transport, timeout):
            captured["timeout"] = timeout

    monkeypatch.setattr(client_module, "Client", FakeClient)
    MCPClient("http://mcp.test/mcp")._session(None, tool)
    return captured["timeout"]


def test_the_repair_gets_the_long_timeout(monkeypatch):
    assert _timeout_for(monkeypatch, "repairOptimizedPlan") == settings.mcp_long_timeout_seconds


def test_an_ordinary_read_gets_the_short_one(monkeypatch):
    assert _timeout_for(monkeypatch, "listEmployees") == settings.mcp_timeout_seconds
