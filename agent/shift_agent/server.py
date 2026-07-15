"""
Shift Agent REST API — Flask-based HTTP interface, meant to sit behind the
website so the frontend chat widget can talk to the agent.
"""

import json
import logging

from flask import Flask, jsonify, request
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from shift_agent.graph import build_graph

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    graph = build_graph()

    @app.route("/api/v1/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"})

    @app.route("/api/v1/chat", methods=["POST"])
    def chat():
        """Send one user message and get the agent's reply.

        Body: { "message": str, "session_id": str (optional) }
        Response: { "session_id": str, "reply": str, "ui_action": {"action": "navigate", "path": str} | null }

        `session_id` scopes conversation history (see graph.py's MemorySaver) —
        pass the same value on every request in a chat session, e.g. a value
        stored in the browser tab.
        """
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 415

        data = request.get_json(silent=True) or {}
        message = data.get("message")
        session_id = data.get("session_id") or "default"
        if not message or not isinstance(message, str):
            return jsonify({"error": "Missing 'message' (string)"}), 400

        config = {"configurable": {"thread_id": session_id}}
        try:
            result = graph.invoke({"messages": [HumanMessage(content=message)]}, config=config)
        except Exception:
            logger.exception("Agent invocation failed")
            return jsonify({"error": "Agent failed to respond"}), 500

        messages = result["messages"]
        reply = next(
            (m.content for m in reversed(messages) if isinstance(m, AIMessage) and m.content),
            "",
        )

        # Surface the most recent navigate tool call, if any, as a structured
        # action the frontend can act on (see tools/navigation.py).
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

        return jsonify({"session_id": session_id, "reply": reply, "ui_action": ui_action})

    return app
