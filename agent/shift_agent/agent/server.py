"""
Shift Agent REST API — Flask-based HTTP interface, meant to sit behind the
website so the frontend chat widget can talk to the agent.

Keycloak auth:
  - If KEYCLOAK_JWKS_URL (or KEYCLOAK_REALM_URL) is configured, every
    POST /api/v1/chat request MUST include an Authorization: Bearer <token>
    header. The token is verified against Keycloak's JWKS endpoint.
  - If neither is set (dev mode), the endpoint accepts requests without
    authentication.

Token forwarding:
  - The request's own X-Access-Token (set by APISIX's openid-connect plugin
    in front of this route), or its Authorization bearer token, is forwarded
    for the duration of the request — see auth.py's set_forwarded_token /
    _forwarded_token. client.py sends it on to the MCP server as
    Authorization: Bearer, which forwards it to the backend, so every call
    runs as the signed-in user.

MCP lifecycle:
  - The remote MCP server (MCP_SERVER_URL) is contacted on the first chat
    request to discover its tools; each tool call then opens its own
    short-lived session (see client.py).
"""

from __future__ import annotations

import asyncio
import json
import logging
from functools import wraps
from typing import Any, Callable

from flask import Flask, jsonify, request
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from shift_agent.agent.auth import (
    reset_forwarded_token,
    set_forwarded_token,
    verify_keycloak_token,
)
from shift_agent.agent.graph import build_graph, connect_mcp, disconnect_mcp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Graph singleton — built once, reused for the process lifetime
# ---------------------------------------------------------------------------
_graph_state: dict | None = None
_graph: Any = None


def _get_or_create_graph():
    """Return the compiled graph, building and connecting MCP on first call."""
    global _graph_state, _graph
    if _graph is not None:
        return _graph

    logger.info("Building agent graph…")
    _graph_state = build_graph()

    # Connect MCP synchronously inside an event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        _graph = loop.run_until_complete(connect_mcp(_graph_state))
    finally:
        loop.close()

    logger.info("Agent graph ready")
    return _graph


# ---------------------------------------------------------------------------
# Keycloak auth decorator
# ---------------------------------------------------------------------------


def _request_token() -> str | None:
    """The caller's access token, from either header the chat endpoint accepts.

    APISIX's openid-connect plugin forwards the already-validated token as the
    raw JWT in X-Access-Token (no "Bearer " prefix) — unlike Authorization,
    it's the token itself, not a scheme+token pair. Where APISIX isn't in front
    of the request (local testing, dev mode), the Authorization bearer token is
    used instead.
    """
    token = request.headers.get("X-Access-Token", "").strip()
    if token:
        return token

    authorization = request.headers.get("Authorization", "").strip()
    if authorization[:7].lower() == "bearer ":
        return authorization[7:].strip() or None
    return None


def require_auth(f: Callable) -> Callable:
    """Decorator that validates the caller's token against Keycloak. In dev
    mode (no Keycloak configured), passes through."""

    @wraps(f)
    def decorated(*args, **kwargs):
        token = _request_token()

        if token is None:
            return jsonify({"error": "Unauthorized — missing Authorization header"}), 401

        # Always call verify_keycloak_token — in dev mode it returns
        # anonymous claims even for None/empty tokens.
        claims = verify_keycloak_token(token)

        if claims is None:
            return jsonify({"error": "Unauthorized — invalid or expired token"}), 401

        # Attach claims to the request context for downstream use
        request.auth_claims = claims  # type: ignore[attr-defined]
        return f(*args, **kwargs)

    return decorated


# ---------------------------------------------------------------------------
# Flask app factory
# ---------------------------------------------------------------------------


def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)

    # ---- Health check (no auth) ----
    @app.route("/api/v1/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"})

    # ---- Chat endpoint (auth-protected) ----
    @app.route("/api/v1/chat", methods=["POST"])
    @require_auth
    def chat():
        """Send one user message and get the agent's reply.

        Body: { "message": str, "session_id": str (optional) }
        Response: { "session_id": str, "reply": str, "ui_action": ... }

        Requires Authorization: Bearer <keycloak-token> when Keycloak is
        configured (see auth.py).
        """
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 415

        data = request.get_json(silent=True) or {}
        message = data.get("message")
        session_id = data.get("session_id") or "default"
        if not message or not isinstance(message, str):
            return jsonify({"error": "Missing 'message' (string)"}), 400

        # Forward this request's own access token (the same one require_auth
        # verified) into auth.py's contextvar, so client.py can present it to
        # the MCP server as Authorization: Bearer. This has to wrap the graph
        # build too, not just the invoke: on the first request _get_or_create_graph()
        # opens a tool-discovery session against the MCP server, and that
        # session needs a token like any other — the MCP server verifies bearer
        # tokens against Keycloak and answers 401 without one.
        reset_token = set_forwarded_token(_request_token())
        try:
            # Build and connect the graph on first request
            try:
                graph = _get_or_create_graph()
            except Exception:
                logger.exception("Graph build / MCP connection failed")
                return jsonify({"error": "Agent backend unavailable"}), 503

            config = {"configurable": {"thread_id": session_id}}

            try:
                result = graph.invoke(
                    {"messages": [HumanMessage(content=message)]},
                    config=config,
                )
            except Exception:
                logger.exception("Agent invocation failed")
                return jsonify({"error": "Agent failed to respond"}), 500
        finally:
            reset_forwarded_token(reset_token)

        messages = result["messages"]
        reply = next(
            (m.content for m in reversed(messages) if isinstance(m, AIMessage) and m.content),
            "",
        )

        # Surface the most recent navigate tool call, if any, as a structured
        # action the frontend can act on (see the MCP server's navigate tool).
        ui_action = None
        for m in reversed(messages):
            if isinstance(m, ToolMessage) and m.name == "navigate":
                try:
                    payload = json.loads(m.content)
                except (TypeError, json.JSONDecodeError):
                    payload = None
                if payload and "action" in payload:
                    ui_action = payload
                break

        return jsonify({
            "session_id": session_id,
            "reply": reply,
            "ui_action": ui_action,
        })

    return app
