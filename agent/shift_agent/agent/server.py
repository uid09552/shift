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

Plan verification:
  - POST /api/v1/plan/validate takes an optimizer result id, re-derives every
    rule the plan was solved under (validation.py) and answers with the
    findings plus a short written review. The counting never goes near the
    model; only the explanation does.

Plan repair:
  - POST /api/v1/plan/fix takes the same result id plus whatever the planner
    typed alongside the Fix button, moves the plan into shape (repair.py) and
    saves it. The moves are decided by the rules; the model only reads the
    planner's sentence and writes the result up. With strategy "resolve" the
    period goes back to the CP-SAT solver instead, through the MCP server's
    optimizeSchedule tool.

File uploads:
  - POST /api/v1/chat/upload takes a roster document (PDF/CSV/XLSX) as
    multipart, parses it to a grid (documents.py), stages it for the session
    (roster.py) and runs one agent turn over a description of it. The agent
    reads the layout and reports back what it would import; nothing is written
    until the user confirms in a following /chat message.

MCP lifecycle:
  - The remote MCP server (MCP_SERVER_URL) is contacted on the first chat
    request to discover its tools; each tool call then opens its own
    short-lived session (see client.py).
  - The agent's own knowledge tools (knowledge.py) are loaded from disk in the
    same step, from the bundle root fixed at startup (--knowledge-path /
    SHIFT_AGENT_KNOWLEDGE_PATH).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from functools import wraps
from typing import Any, Callable

from flask import Flask, jsonify, request
from werkzeug.utils import secure_filename
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from shift_agent import build_info, telemetry
from shift_agent.agent.auth import (
    reset_forwarded_token,
    set_forwarded_token,
    verify_keycloak_token,
)
from shift_agent.agent.documents import (
    SUPPORTED_EXTENSIONS,
    DocumentError,
    parse_document,
)
from shift_agent.agent.graph import build_graph, build_llm, connect_mcp, disconnect_mcp
from shift_agent.agent import repair, replacement, roster, validation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Largest roster upload accepted. A month's plan is a few hundred kilobytes
# even as a PDF; the cap is here so a mis-drop can't hand the parser a
# gigabyte.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# ---------------------------------------------------------------------------
# Graph singleton — built once, reused for the process lifetime
# ---------------------------------------------------------------------------
_graph_state: dict | None = None
_graph: Any = None
# Knowledge bundle root chosen at startup by create_app() (shift-agent api
# --knowledge-path); None = whatever SHIFT_AGENT_KNOWLEDGE_PATH resolves to.
_knowledge_path: str | None = None
# The narration model for POST /plan/validate, built on first use. Separate
# from the graph's: this call binds no tools and holds no conversation, it just
# turns a finished report into prose.
_narrator: Any = None


def _get_or_create_graph():
    """Return the compiled graph, building and connecting MCP on first call."""
    global _graph_state, _graph
    if _graph is not None:
        return _graph

    logger.info("Building agent graph…")
    _graph_state = build_graph(knowledge_path=_knowledge_path)

    # Connect MCP synchronously inside an event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        _graph = loop.run_until_complete(connect_mcp(_graph_state))
    finally:
        loop.close()

    logger.info("Agent graph ready")
    return _graph


def _get_narrator():
    """The plain LLM used to write up a validation report, or None if the
    provider is unreachable/unconfigured — in which case the report still goes
    out, with its own plain-language headline instead."""
    global _narrator
    if _narrator is None:
        try:
            _narrator = build_llm()
        except Exception:
            logger.exception("No LLM for validation narration — reporting findings only")
            _narrator = False
    return _narrator or None


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


def create_app(knowledge_path: str | None = None) -> Flask:
    """Create and configure the Flask application.

    Args:
        knowledge_path: root of the documentation bundle the agent answers
            product questions from, overriding SHIFT_AGENT_KNOWLEDGE_PATH.
            Fixed here, at startup, because the graph is a process-wide
            singleton shared by every request.
    """
    global _knowledge_path
    _knowledge_path = knowledge_path

    app = Flask(__name__)
    # Reject an oversized body before Werkzeug buffers it; the upload handler
    # checks the parsed size again for a message the user can act on.
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
    # One server span per request, named after the route. No-op unless an OTLP
    # endpoint is configured (see telemetry.init_telemetry, called at startup).
    telemetry.instrument_flask(app)

    # ---- Health check (no auth) ----
    @app.route("/api/v1/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", **build_info()})

    # ---- One agent turn, shared by /chat and /chat/upload ----
    def _run_turn(message: str, session_id: str):
        """Run the graph over one user message and build the JSON response.

        Returns a Flask response tuple either way — the error paths answer with
        a status of their own, so the callers just return what comes back.
        """
        # Forward this request's own access token (the same one require_auth
        # verified) into auth.py's contextvar, so client.py can present it to
        # the MCP server as Authorization: Bearer. This has to wrap the graph
        # build too, not just the invoke: on the first request _get_or_create_graph()
        # opens a tool-discovery session against the MCP server, and that
        # session needs a token like any other — the MCP server verifies bearer
        # tokens against Keycloak and answers 401 without one.
        reset_token = set_forwarded_token(_request_token())
        started = time.perf_counter()
        try:
            # One span over the whole turn: the LLM calls and MCP tool calls it
            # makes hang under it (see telemetry's httpx instrumentation).
            with telemetry.span(
                "agent.chat",
                **{"agent.session_id": session_id, "agent.message.length": len(message)},
            ) as chat_span:
                # Build and connect the graph on first request
                try:
                    graph = _get_or_create_graph()
                except Exception:
                    logger.exception("Graph build / MCP connection failed")
                    telemetry.record_chat(time.perf_counter() - started, "unavailable")
                    return jsonify({"error": "Agent backend unavailable"}), 503

                config = {"configurable": {"thread_id": session_id}}

                try:
                    result = graph.invoke(
                        {"messages": [HumanMessage(content=message)]},
                        config=config,
                    )
                except Exception:
                    logger.exception("Agent invocation failed")
                    telemetry.record_chat(time.perf_counter() - started, "error")
                    return jsonify({"error": "Agent failed to respond"}), 500

                telemetry.set_attributes(
                    chat_span, **{"agent.messages": len(result["messages"])}
                )
                telemetry.record_chat(time.perf_counter() - started, "ok")
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

        return _run_turn(message, session_id)

    # ---- Plan verification (auth-protected) ----
    @app.route("/api/v1/plan/validate", methods=["POST"])
    @require_auth
    def validate_plan():
        """Check a proposed shift plan against the rules it was solved under.

        Body: { "result_id": str }
        Response: the validation report — verdict, counts, one entry per rule
        broken, and `summary`, a short written review of them.

        The checks are arithmetic (validation.py) and run on every request; the
        model only writes them up, so two calls on an unchanged plan cannot
        disagree about what is wrong with it.
        """
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 415

        data = request.get_json(silent=True) or {}
        result_id = data.get("result_id")
        if not result_id or not isinstance(result_id, str):
            return jsonify({"error": "Missing 'result_id' (string)"}), 400

        # The rules and the plan are fetched through MCP as the signed-in user,
        # exactly as a chat tool call would be.
        reset_token = set_forwarded_token(_request_token())
        started = time.perf_counter()
        try:
            with telemetry.span("agent.validate_plan", **{"agent.result_id": result_id}):
                try:
                    graph = _get_or_create_graph()
                except Exception:
                    logger.exception("Graph build / MCP connection failed")
                    return jsonify({"error": "Agent backend unavailable"}), 503

                try:
                    rules, result, capability_names = validation.collect(
                        graph.mcp_client.call_sync, result_id
                    )
                    report = validation.validate(rules, result, capability_names)
                except validation.ValidationError as exc:
                    # Either the plan/rules could not be fetched, or what came
                    # back is not something this check can be run against.
                    return jsonify({"error": str(exc)}), 404
                except Exception:
                    logger.exception("Could not check plan %s", result_id)
                    return jsonify({"error": "The plan could not be checked."}), 502

                report["result_id"] = result_id
                report["headline"] = validation.headline(report)
                report["summary"] = validation.narrate(report, _get_narrator())
        finally:
            reset_forwarded_token(reset_token)

        logger.info(
            "Validated plan %s in %.1fs — %s (%d error(s), %d warning(s))",
            result_id,
            time.perf_counter() - started,
            report["verdict"],
            report["error_count"],
            report["warning_count"],
        )
        return jsonify(report)

    # ---- Plan repair (auth-protected) ----
    @app.route("/api/v1/plan/fix", methods=["POST"])
    @require_auth
    def fix_plan():
        """Fix a proposed shift plan and save the result.

        Body: { "result_id": str, "instruction": str (optional),
                "strategy": "repair" | "resolve" (optional) }
        Response: what the check said before, what was changed, what the check
        says now, anything that could not be done, and `summary` — a short
        written report of all of it.

        Everything that moves is decided by re-derived rules, not by the model:
        the assistant reads the planner's instruction and writes the report,
        and each move it leads to is refused if it would break a rule. The
        repaired plan is written back through the same endpoint the scheduler
        page's own edits use, so the page shows it after a reload.
        """
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 415

        data = request.get_json(silent=True) or {}
        result_id = data.get("result_id")
        if not result_id or not isinstance(result_id, str):
            return jsonify({"error": "Missing 'result_id' (string)"}), 400
        instruction = data.get("instruction") or ""
        if not isinstance(instruction, str):
            return jsonify({"error": "'instruction' must be a string"}), 400
        strategy = data.get("strategy") or "repair"
        if strategy not in ("repair", "resolve"):
            return jsonify({"error": "'strategy' must be 'repair' or 'resolve'"}), 400

        reset_token = set_forwarded_token(_request_token())
        started = time.perf_counter()
        try:
            with telemetry.span(
                "agent.fix_plan",
                **{"agent.result_id": result_id, "agent.strategy": strategy},
            ):
                try:
                    graph = _get_or_create_graph()
                except Exception:
                    logger.exception("Graph build / MCP connection failed")
                    return jsonify({"error": "Agent backend unavailable"}), 503

                try:
                    report = repair.fix(
                        graph.mcp_client.call_sync,
                        result_id,
                        instruction=instruction,
                        strategy=strategy,
                        llm=_get_narrator(),
                    )
                except validation.ValidationError as exc:
                    return jsonify({"error": str(exc)}), 404
                except repair.RepairError as exc:
                    # The plan could not be re-solved or could not be saved —
                    # a real answer for the planner, not an internal error.
                    return jsonify({"error": str(exc)}), 409
                except Exception:
                    logger.exception("Could not repair plan %s", result_id)
                    return jsonify({"error": "The plan could not be repaired."}), 502

                report["summary"] = repair.narrate(report, _get_narrator())
        finally:
            reset_forwarded_token(reset_token)

        logger.info(
            "Repaired plan %s in %.1fs — %s, %s change(s), %d error(s) left",
            result_id,
            time.perf_counter() - started,
            report["strategy"],
            report.get("change_count"),
            report["after"]["error_count"],
        )
        return jsonify(report)

    # ---- Short-notice replacement (auth-protected) ----
    @app.route("/api/v1/roster/replacements", methods=["POST"])
    @require_auth
    def find_replacements():
        """Who can take an absent person's shift in the confirmed roster.

        Body: { "employee_id": str, "date": "YYYY-MM-DD" }
        Response: the slot, the colleagues who may legally take it ranked
        best first (wish, preferred day off, hours below target, rest), and
        everyone else with the rule that rules them out. Nothing is written.
        """
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 415
        data = request.get_json(silent=True) or {}
        employee_id = data.get("employee_id")
        if not employee_id or not isinstance(employee_id, str):
            return jsonify({"error": "Missing 'employee_id' (string)"}), 400
        day = replacement._parse_day(data.get("date"))
        if day is None:
            return jsonify({"error": "Missing or invalid 'date' (YYYY-MM-DD)"}), 400

        reset_token = set_forwarded_token(_request_token())
        try:
            with telemetry.span("agent.find_replacements", **{"agent.date": day.isoformat()}):
                try:
                    graph = _get_or_create_graph()
                except Exception:
                    logger.exception("Graph build / MCP connection failed")
                    return jsonify({"error": "Agent backend unavailable"}), 503
                try:
                    answer = replacement.search(graph.mcp_client.call_sync, employee_id, day)
                except validation.ValidationError as exc:
                    return jsonify({"error": str(exc)}), 404
                except repair.RepairError as exc:
                    return jsonify({"error": str(exc)}), 404
                except Exception:
                    logger.exception("Replacement search failed for %s on %s", employee_id, day)
                    return jsonify({"error": "The replacement search failed."}), 502
        finally:
            reset_forwarded_token(reset_token)

        logger.info(
            "Replacement for %s on %s: %d candidate(s), %d unavailable",
            employee_id, day, len(answer["candidates"]), len(answer["unavailable"]),
        )
        return jsonify(answer)

    # ---- Roster file upload (auth-protected) ----
    @app.route("/api/v1/chat/upload", methods=["POST"])
    @require_auth
    def chat_upload():
        """Attach a roster document to the conversation and have it read.

        Multipart form: file=<pdf|csv|xlsx>, session_id (optional),
        message (optional — whatever the user typed alongside the attachment).
        Response: the same shape as /chat, plus `upload` describing the file.

        The file itself never reaches the model. It is parsed into a grid and
        staged in roster.py; what the model gets is a description and the first
        rows, and it works out the layout from that. Nothing is written here —
        the agent is instructed to report its reading and wait for the user to
        accept it (see graph.py's system prompt).
        """
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            return jsonify({
                "error": "Missing 'file' in the upload. Accepted types: "
                         + ", ".join(SUPPORTED_EXTENSIONS),
            }), 400

        session_id = request.form.get("session_id") or "default"
        note = (request.form.get("message") or "").strip()

        data = upload.read()
        if not data:
            return jsonify({"error": "The uploaded file is empty"}), 400
        if len(data) > MAX_UPLOAD_BYTES:
            return jsonify({
                "error": f"File too large — the limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
            }), 413

        filename = secure_filename(upload.filename) or upload.filename
        try:
            document = parse_document(filename, data)
        except DocumentError as exc:
            # A user-facing message by construction — say what is wrong with
            # their file rather than "bad request".
            return jsonify({"error": str(exc)}), 400
        except Exception:
            logger.exception("Failed to parse upload %s", filename)
            return jsonify({"error": "The file could not be read."}), 400

        staged = roster.store.add(session_id, document)
        logger.info(
            "Roster upload %s staged for session %s — %s, %d sheet(s)",
            staged.upload_id,
            session_id,
            filename,
            len(document.sheets),
        )

        message = (
            "The user has attached a shift roster file. Work out how it is laid "
            "out, call interpretRosterUpload, then show what you read and ask "
            "whether to take it as their shift assignments. Do not write "
            "anything yet.\n\n"
            + roster.describe_upload(staged)
        )
        if note:
            message += f"\n\nThe user also wrote: {note}"

        response = _run_turn(message, session_id)
        # _run_turn hands back either the reply or an error tuple; only the
        # former should carry the upload details.
        if isinstance(response, tuple):
            return response
        payload = response.get_json()
        payload["upload"] = {
            "upload_id": staged.upload_id,
            "filename": filename,
            "kind": document.kind,
            "sheets": [
                {"name": sheet.name, "rows": sheet.height, "columns": sheet.width}
                for sheet in document.sheets
            ],
        }
        return jsonify(payload)

    return app
