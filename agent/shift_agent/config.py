"""
Shift Agent configuration, sourced from environment variables (see .env.example).
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # ChatOpenAI reads OPENAI_API_KEY from the environment automatically —
    # nothing to wire up here beyond making sure .env is loaded (above).
    model: str = os.environ.get("SHIFT_AGENT_MODEL", "gpt-4o")
    max_tokens: int = int(os.environ.get("SHIFT_AGENT_MAX_TOKENS", "4096"))

    backend_api_url: str = os.environ.get("BACKEND_API_URL", "http://localhost/api/v1")
    # Forwarded as x-access-token on every backend call. Unset when the backend
    # runs with --dev-mode. See README "Multi-tenant auth" for the production story.
    backend_access_token: str | None = os.environ.get("BACKEND_ACCESS_TOKEN") or None

    # mcp_server.py's own incoming-client auth (MultiAuth: OIDCProxy + JWTVerifier).
    # Only takes effect over HTTP transport, and only if both are set — the
    # MCP server has no auth of its own otherwise (see shift_agent/auth.py).
    keycloak_realm_url: str = os.environ.get("KEYCLOAK_REALM_URL", "http://localhost/auth/realms/shift")
    mcp_base_url: str = os.environ.get("MCP_BASE_URL", "http://localhost:8900")
    mcp_oauth_client_id: str | None = os.environ.get("MCP_OAUTH_CLIENT_ID") or None
    mcp_oauth_client_secret: str | None = os.environ.get("MCP_OAUTH_CLIENT_SECRET") or None


settings = Settings()
