"""
Authentication for the MCP server: which access token its backend calls carry.

The server is multi-tenant — whoever calls it presents a token, and that token
is what the Rust backend sees (as Authorization: Bearer, validated by APISIX's
openid-connect plugin on /api/*, which forwards it to the backend as
X-Access-Token). Callers are the chat agent (shift_agent.agent, forwarding the
signed-in user's token) and external MCP clients alike. A static
BACKEND_ACCESS_TOKEN is the fallback for callers that present none — e.g. the
stdio transport, where HTTP-level auth doesn't apply at all.

The chat agent's own auth — verifying users and picking the token to send here
— lives in shift_agent/agent/auth.py.
"""

from __future__ import annotations

import logging

import httpx
from fastmcp.server.dependencies import get_access_token as get_incoming_access_token
from fastmcp.server.dependencies import get_http_headers

from shift_agent.config import settings

logger = logging.getLogger(__name__)


def _incoming_token() -> str | None:
    """The token the current MCP request presented, to be passed straight
    through to the backend.

    Preferred source is FastMCP's authenticated access token (server.py's
    MultiAuth, which verifies it against Keycloak whether or not
    MCP_OAUTH_CLIENT_ID/SECRET are set). When server-level auth is off
    entirely — Keycloak unreachable — nothing is verified here, but the
    caller's header is still the right token to forward: the backend behind
    APISIX validates it either way. So fall back to the raw header rather than
    silently dropping to the static token.

    None outside of an HTTP request context (e.g. stdio transport).
    """
    access_token = get_incoming_access_token()
    if access_token:
        return access_token.token

    # get_http_headers() strips authorization by default; ask for it back.
    headers = get_http_headers(include={"authorization"})
    authorization = headers.get("authorization", "")
    if authorization[:7].lower() == "bearer ":
        return authorization[7:].strip() or None
    return headers.get("x-access-token") or None


def get_access_token() -> str | None:
    """Sync resolution, for httpx.Client callers."""
    return _incoming_token() or settings.backend_access_token


async def get_access_token_async() -> str | None:
    """Async resolution, for httpx.AsyncClient callers (server.py's client)."""
    return _incoming_token() or settings.backend_access_token


def _authorize(request: httpx.Request, token: str) -> None:
    """Put the token on a backend request under both header names.

    The backend resolves the caller's tenant from **X-Access-Token** and
    nothing else (src/services/tenant.rs), so that header is what actually
    authorizes the call when BACKEND_API_URL points straight at it, as in
    deploy/docker-compose.yml. Authorization: Bearer is for the other topology
    — BACKEND_API_URL through APISIX, whose openid-connect plugin verifies the
    bearer token and sets X-Access-Token itself, overwriting ours. Sending both
    keeps either deployment working.
    """
    request.headers["Authorization"] = f"Bearer {token}"
    request.headers["X-Access-Token"] = token


class BackendTokenAuth(httpx.Auth):
    """Attaches the caller's token per-request, resolving it lazily (see
    get_access_token[_async] above) so a long-lived client (server.py's
    persistent AsyncClient) always sends the current request's own token
    instead of one baked in at construction time."""

    def auth_flow(self, request: httpx.Request):
        token = get_access_token()
        if token:
            _authorize(request, token)
        yield request

    async def async_auth_flow(self, request: httpx.Request):
        token = await get_access_token_async()
        if token:
            _authorize(request, token)
        yield request
