"""
Resolves the access token the agent's backend-calling tools send as an
Authorization: Bearer header (validated by APISIX's openid-connect plugin on
/api/*, which then forwards it to the Rust backend as X-Access-Token).

mcp_server.py is multi-tenant: many different MCP clients/users can be
connected concurrently, each authenticated against Keycloak with their OWN
token (see mcp_server.py's MultiAuth). Priority here, checked fresh on every
call — nothing here is cached per-user; FastMCP already scopes the incoming
token per-request via a contextvar, so there's no cache to get wrong:

1. The current request's own incoming token, as authenticated by FastMCP's
   auth provider — the real per-tenant path, reused as-is for backend calls.
   Only present over HTTP transport with auth configured (mcp_server.py).
2. BACKEND_ACCESS_TOKEN — a single static token (dev/single-tenant use, or
   the stdio transport, which has no per-request FastMCP auth at all).
"""

import httpx
from fastmcp.server.dependencies import get_access_token as get_incoming_access_token

from shift_agent.config import settings


def _incoming_token() -> str | None:
    """The current MCP request's own token, as authenticated by FastMCP
    (mcp_server.py's MultiAuth). None outside of an authenticated FastMCP
    HTTP request context — e.g. stdio transport, or no auth configured."""
    access_token = get_incoming_access_token()
    return access_token.token if access_token else None


def get_access_token() -> str | None:
    """Sync resolution, for httpx.Client callers (tools/backend_api.py)."""
    token = _incoming_token()
    if token:
        return token
    return settings.backend_access_token


async def get_access_token_async() -> str | None:
    """Async resolution, for httpx.AsyncClient callers (mcp_server.py)."""
    token = _incoming_token()
    if token:
        return token
    return settings.backend_access_token


class BackendTokenAuth(httpx.Auth):
    """Attaches Authorization: Bearer per-request, resolving it lazily (see
    get_access_token[_async] above) so a long-lived client (mcp_server.py's
    persistent AsyncClient) always sends the current request's own token
    instead of one baked in at construction time."""

    def auth_flow(self, request: httpx.Request):
        token = get_access_token()
        if token:
            request.headers["Authorization"] = f"Bearer {token}"
        yield request

    async def async_auth_flow(self, request: httpx.Request):
        token = await get_access_token_async()
        if token:
            request.headers["Authorization"] = f"Bearer {token}"
        yield request
