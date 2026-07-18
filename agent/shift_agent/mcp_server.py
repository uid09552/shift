"""
MCP server exposing the Rust backend's REST API (../../api/openapi.yaml) as MCP
tools, one per operation, generated directly from the spec via FastMCP —
unlike tools/backend_api.py, which hand-picks and curates a handful of tools
for the LangGraph chat agent, this is full, unopinionated coverage of the API
for use by any MCP client (Claude Code, Claude Desktop, etc.).

Multi-tenant auth: over HTTP transport, connecting MCP clients authenticate
against Keycloak via the OAuth2 authorization code grant + Dynamic Client
Registration (MultiAuth's `server`, below) — each client ends up with its OWN
access token, which auth.py forwards as-is to the backend on every call.
`verifiers` additionally lets a caller that already holds a Keycloak-issued
bearer token (e.g. from the client credentials grant) skip the interactive
flow and present it directly. Nothing about this is cached process-wide: it's
scoped per-request by FastMCP's own auth context (see auth.py). A static
BACKEND_ACCESS_TOKEN remains as a fallback for requests with no per-client
token — e.g. the stdio transport, where this server-level auth doesn't apply
at all (see auth.py, and FastMCP's docs: auth is HTTP-only).
"""

from pathlib import Path

import httpx
import yaml
from fastmcp import FastMCP
from fastmcp.server.auth import JWTVerifier, MultiAuth
from fastmcp.server.auth.oidc_proxy import OIDCProxy

from shift_agent.auth import BackendTokenAuth
from shift_agent.config import settings

OPENAPI_SPEC_PATH = Path(__file__).resolve().parents[2] / "api" / "openapi.yaml"


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
    matching every other optional-auth fallback in this project (see auth.py).
    """
    client_id = settings.mcp_oauth_client_id
    client_secret = settings.mcp_oauth_client_secret
    if not (client_id and client_secret):
        return None

    realm_url = settings.keycloak_realm_url
    return MultiAuth(
        server=OIDCProxy(
            config_url=f"{realm_url}/.well-known/openid-configuration",
            client_id=client_id,
            client_secret=client_secret,
            base_url=settings.mcp_base_url,
            # Without this, the proxy advertises no supported scopes, so
            # clients that fall back to requesting the standard OIDC scopes
            # (e.g. mcp-remote's default "openid email profile") get rejected
            # by its own DCR endpoint with "Requested scopes are not valid".
            required_scopes=["openid", "profile", "email"],
        ),
        verifiers=[
            JWTVerifier(
                jwks_uri=f"{realm_url}/protocol/openid-connect/certs",
                issuer=realm_url,
            )
        ],
    )


def build_mcp_server() -> FastMCP:
    return FastMCP.from_openapi(
        openapi_spec=_load_openapi_spec(),
        client=_client(),
        name="Shift Backend API",
        auth=_build_auth(),
    )


mcp = build_mcp_server()


if __name__ == "__main__":
    mcp.run()
