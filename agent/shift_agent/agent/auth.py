"""
Authentication for the chat agent. Two paths, both about the same token:

1. **Chat API auth** (server.py) — validates the token on POST /api/v1/chat
   (Authorization: Bearer, or APISIX's X-Access-Token) against Keycloak's JWKS
   endpoint, so only authenticated users can talk to the agent.

2. **Outgoing token** (server.py + client.py) — that same token is stashed in a
   contextvar for the duration of the agent call and presented to the MCP
   server on every tool call, so backend work the agent does on the user's
   behalf runs as that user rather than under one static token.

The MCP server's own side of this — what token its backend calls carry — lives
in shift_agent/mcp/auth.py. Nothing is shared between the two beyond the token
on the wire.
"""

from __future__ import annotations

import logging
from contextvars import ContextVar, Token
from typing import Any

from jwt import PyJWKClient, PyJWTError

from shift_agent.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Outgoing token — the current request's token, on its way to the MCP server
# ---------------------------------------------------------------------------

# server.py puts the chat request's own token here for the duration of a single
# graph.invoke() call; client.py reads it back out on every tool call and puts
# it on the wire as Authorization: Bearer.
_forwarded_token: ContextVar[str | None] = ContextVar("forwarded_token", default=None)


def set_forwarded_token(token: str | None) -> Token:
    """Set the current request's token for MCP calls made further down the
    same call stack. Returns a token to pass to reset_forwarded_token()."""
    return _forwarded_token.set(token)


def reset_forwarded_token(reset_token: Token) -> None:
    _forwarded_token.reset(reset_token)


def get_outgoing_token() -> str | None:
    """The token to present to the MCP server: this request's own, falling back
    to the static BACKEND_ACCESS_TOKEN (unauthenticated CLI chat, dev-mode
    backend). None means the call goes out without an Authorization header."""
    return _forwarded_token.get() or settings.backend_access_token


# ---------------------------------------------------------------------------
# Chat API auth — Keycloak token verification for the chat REST endpoint
# ---------------------------------------------------------------------------

# Cache the JWKS client so we don't fetch the keyset on every request
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient | None:
    """Lazily initialise the JWKS client from the configured Keycloak realm."""
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client

    jwks_url = settings.keycloak_jwks_url
    if not jwks_url:
        # Derive from the realm URL if not explicitly set
        realm_url = settings.keycloak_realm_url
        jwks_url = f"{realm_url}/protocol/openid-connect/certs"

    try:
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
        logger.info("JWKS client initialized from %s", jwks_url)
        return _jwks_client
    except Exception:
        logger.exception("Failed to initialize JWKS client from %s", jwks_url)
        return None


def _is_dev_mode() -> bool:
    """Return True when Keycloak auth is not explicitly configured.

    Dev mode is active when:
    - ``KEYCLOAK_JWKS_URL`` is not set, AND
    - ``KEYCLOAK_REALM_URL`` is either unset or still at its default value
      (``http://localhost/auth/realms/shift``).

    The default realm URL is a reasonable guess for local development, but
    without an explicit opt-in (setting ``KEYCLOAK_JWKS_URL``) we treat it
    as dev mode so the agent works out of the box with zero config.
    """
    if settings.keycloak_jwks_url:
        return False
    # If the realm URL is still the default, treat as dev mode
    realm_url = settings.keycloak_realm_url
    if not realm_url or realm_url == "http://localhost/auth/realms/shift":
        return True
    return False


def verify_keycloak_token(token: str) -> dict[str, Any] | None:
    """Verify a Keycloak-issued bearer token and return its decoded claims.

    Returns the claims dict on success, or None if the token is invalid /
    expired / untrusted. When no Keycloak auth is configured (dev mode),
    returns a minimal claims dict with a ``sub`` of ``"anonymous"`` so the
    caller can still proceed.
    """
    # Dev mode: no JWKS configured — accept any token or no token
    if _is_dev_mode():
        return {"sub": "anonymous", "preferred_username": "anonymous"}

    client = _get_jwks_client()
    if client is None:
        logger.warning("JWKS client unavailable — falling back to anonymous")
        return {"sub": "anonymous", "preferred_username": "anonymous"}

    try:
        signing_key = client.get_signing_key_from_jwt(token)
        from jwt import decode as jwt_decode

        claims = jwt_decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_exp": True, "verify_aud": False},
        )
        return claims
    except PyJWTError as exc:
        logger.warning("Keycloak token verification failed: %s", exc)
        return None
    except Exception as exc:
        logger.exception("Unexpected error during token verification: %s", exc)
        return None
