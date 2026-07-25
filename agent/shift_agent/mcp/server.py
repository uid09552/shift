"""
MCP server exposing the Rust backend's REST API (../../../api/openapi.yaml) as MCP
tools, one per operation, generated directly from the spec via FastMCP — full,
unopinionated coverage of the API for use by any MCP client (the chat agent
itself, Claude Code, Claude Desktop, etc.). Plus `navigate`, the one tool that
has no REST equivalent because it targets the browser rather than the backend.

Multi-tenant auth: over HTTP transport, connecting MCP clients authenticate
against Keycloak via the OAuth2 authorization code grant + Dynamic Client
Registration (MultiAuth's `server`, below) — each client ends up with its OWN
access token, which mcp/auth.py forwards as-is to the backend on every call.
`verifiers` additionally lets a caller that already holds a Keycloak-issued
bearer token (e.g. from the client credentials grant) skip the interactive
flow and present it directly. Nothing about this is cached process-wide: it's
scoped per-request by FastMCP's own auth context (see mcp/auth.py). A static
BACKEND_ACCESS_TOKEN remains as a fallback for requests with no per-client
token — e.g. the stdio transport, where this server-level auth doesn't apply
at all (see mcp/auth.py, and FastMCP's docs: auth is HTTP-only).
"""

import json
import logging
from pathlib import Path

import httpx
import yaml
from fastmcp import FastMCP
from fastmcp.server.auth import JWTVerifier, MultiAuth
from fastmcp.server.auth.oidc_proxy import OIDCProxy

from shift_agent.config import settings
from shift_agent.mcp.auth import BackendTokenAuth

logger = logging.getLogger(__name__)

# shift_agent/mcp/server.py -> mcp -> shift_agent -> agent -> backend/api/…
# In deploy/Dockerfile.agent the same three levels up land on the image root,
# where the spec is copied to /api/openapi.yaml.
OPENAPI_SPEC_PATH = Path(__file__).resolve().parents[3] / "api" / "openapi.yaml"


def _load_openapi_spec() -> dict:
    with open(OPENAPI_SPEC_PATH) as f:
        return yaml.safe_load(f)


def _client() -> httpx.AsyncClient:
    # BackendTokenAuth resolves the token per-request rather than once at
    # construction time, so each connected client's own token (or a
    # refreshed fallback token) is picked up even though this client is
    # built once and reused for the server's life.
    return httpx.AsyncClient(base_url=settings.backend_api_url, auth=BackendTokenAuth(), timeout=10.0)


def _build_auth() -> MultiAuth | None:
    """Authenticate incoming MCP clients against Keycloak, if configured.

    Returns None (no server-level auth) unless MCP_OAUTH_CLIENT_ID/SECRET are
    set — keeps `shift-agent mcp` working with zero Keycloak/OAuth setup,
    matching every other optional-auth fallback in this project (see mcp/auth.py).

    If Keycloak is unreachable (e.g. during local development), falls back to
    no auth rather than crashing the server.
    """
    client_id = settings.mcp_oauth_client_id
    client_secret = settings.mcp_oauth_client_secret
    if not (client_id and client_secret):
        return None

    realm_url = settings.keycloak_realm_url
    config_url = f"{realm_url}/.well-known/openid-configuration"
    jwks_uri = f"{realm_url}/protocol/openid-connect/certs"

    # Probe Keycloak before building auth — if it's unreachable, fall back
    # to no auth so the server starts without crashing.
    try:
        resp = httpx.get(config_url, timeout=3.0)
        resp.raise_for_status()
    except Exception:
        logger.warning(
            "Keycloak unreachable at %s — MCP server auth disabled. "
            "Set MCP_OAUTH_CLIENT_ID/SECRET and ensure Keycloak is running.",
            config_url,
        )
        return None

    return MultiAuth(
        server=OIDCProxy(
            config_url=config_url,
            client_id=client_id,
            client_secret=client_secret,
            base_url=settings.mcp_base_url,
            required_scopes=["openid", "profile", "email"],
        ),
        verifiers=[
            JWTVerifier(
                jwks_uri=jwks_uri,
                issuer=realm_url,
            )
        ],
    )


# Frontend routes the `navigate` tool below can send the browser to.
# Keep in sync with ui/src/app/app.routes.ts
KNOWN_PAGES = {
    "dashboard": "/",
    "schedule": "/kalender",
    "employee_calendar": "/employee-calendar",
    "workstation_calendar": "/workstation-calendar",
    "scheduler": "/scheduler",
    "user_profiles": "/user-profiles",
    "shifts": "/shifts",
    "workstations": "/workstations",
    "capabilities": "/capabilities",
    "planner_settings": "/planner-settings",
}


def _register_navigation(mcp: FastMCP) -> None:
    """Add the `navigate` tool — the odd one out, since it resolves a page name
    to a frontend route instead of calling the backend. The agent's Flask layer
    (agent/server.py) picks the result back out of the message history and returns it
    to the caller as a `ui_action`, so the website's chat widget can perform the
    actual `router.navigate()`."""

    @mcp.tool
    def navigate(page: str) -> str:
        """Send the user's browser to a page in the app.

        Args:
            page: One of: dashboard, schedule, employee_calendar,
                workstation_calendar, scheduler, user_profiles, shifts,
                workstations, capabilities, planner_settings.
        """
        path = KNOWN_PAGES.get(page)
        if not path:
            return json.dumps({
                "error": f"Unknown page '{page}'. Valid pages: {', '.join(sorted(KNOWN_PAGES))}",
            })
        return json.dumps({"action": "navigate", "path": path})


def build_mcp_server() -> FastMCP:
    mcp = FastMCP.from_openapi(
        openapi_spec=_load_openapi_spec(),
        client=_client(),
        name="Shift Backend API",
        auth=_build_auth(),
    )
    _register_navigation(mcp)
    return mcp


# Lazily initialised — the first call to get_mcp() builds the server.
_mcp_instance: FastMCP | None = None


def get_mcp() -> FastMCP:
    """Return the singleton MCP server instance, building it on first call."""
    global _mcp_instance
    if _mcp_instance is None:
        _mcp_instance = build_mcp_server()
    return _mcp_instance


if __name__ == "__main__":
    get_mcp().run()
