"""
MCP server exposing the Rust backend's REST API (../../api/openapi.yaml) as MCP
tools, one per operation, generated directly from the spec via FastMCP —
unlike tools/backend_api.py, which hand-picks and curates a handful of tools
for the LangGraph chat agent, this is full, unopinionated coverage of the API
for use by any MCP client (Claude Code, Claude Desktop, etc.).
"""

from pathlib import Path

import httpx
import yaml
from fastmcp import FastMCP

from shift_agent.config import settings

OPENAPI_SPEC_PATH = Path(__file__).resolve().parents[2] / "api" / "openapi.yaml"


def _load_openapi_spec() -> dict:
    with open(OPENAPI_SPEC_PATH) as f:
        return yaml.safe_load(f)


def _client() -> httpx.AsyncClient:
    headers = {}
    if settings.backend_access_token:
        headers["x-access-token"] = settings.backend_access_token
    return httpx.AsyncClient(base_url=settings.backend_api_url, headers=headers, timeout=10.0)


def build_mcp_server() -> FastMCP:
    return FastMCP.from_openapi(
        openapi_spec=_load_openapi_spec(),
        client=_client(),
        name="Shift Backend API",
    )


mcp = build_mcp_server()


if __name__ == "__main__":
    mcp.run()
