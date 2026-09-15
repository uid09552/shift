"""
MCP server exposing the Rust backend's REST API (../../../api/openapi.yaml) as MCP
tools, one per operation, generated directly from the spec via FastMCP — full,
unopinionated coverage of the API for use by any MCP client (the chat agent
itself, Claude Code, Claude Desktop, etc.). Plus `navigate`, the one tool that
has no REST equivalent because it targets the browser rather than the backend,
and `optimizeSchedule`, which runs the CP-SAT solver synchronously against the
optimizer service — the spec's own planning endpoints only queue a job.

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
from fastmcp.server.middleware import Middleware, MiddlewareContext

from shift_agent import telemetry
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
    """Authenticate incoming MCP clients against Keycloak, if it is reachable.

    Both modes below verify presented tokens with the same JWTVerifier; they
    differ only in whether a client can *obtain* a token from this server:

      - MCP_OAUTH_CLIENT_ID/SECRET set — full OIDCProxy, so a client arriving
        without a token can run the authorization code + DCR flow itself.
      - unset — verifiers only: no OAuth routes and no interactive flow, but a
        caller that already holds a Keycloak-issued token (the chat agent
        forwarding the signed-in user's, or a client credentials grant) is
        still verified rather than waved through. This is what the `mcp`
        service in deploy/docker-compose.yml runs, where OIDCProxy is not an
        option because MCP_BASE_URL is not an HTTPS URL.

    Returns None — no server-level auth at all — only when Keycloak itself is
    unreachable (e.g. during local development), so the server starts instead
    of crashing.
    """
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
            "Ensure Keycloak is running to enable token verification.",
            config_url,
        )
        return None

    verifier = JWTVerifier(jwks_uri=jwks_uri, issuer=realm_url)

    client_id = settings.mcp_oauth_client_id
    client_secret = settings.mcp_oauth_client_secret
    if not (client_id and client_secret):
        logger.info(
            "MCP_OAUTH_CLIENT_ID/SECRET unset — verifying bearer tokens against "
            "%s, but not offering the interactive OAuth flow.",
            realm_url,
        )
        return MultiAuth(verifiers=[verifier])

    return MultiAuth(
        server=OIDCProxy(
            config_url=config_url,
            client_id=client_id,
            client_secret=client_secret,
            base_url=settings.mcp_base_url,
            required_scopes=["openid", "profile", "email"],
        ),
        verifiers=[verifier],
    )


# Frontend routes the `navigate` tool below can send the browser to.
# Keep in sync with ui/src/app/app.routes.ts
KNOWN_PAGES = {
    "dashboard": "/",
    "schedule": "/kalender",
    "day_view": "/day-view",
    "employee_calendar": "/employee-calendar",
    # The standalone workstation calendar was removed as a duplicate of the
    # schedule page's "By workstation" lens; the name still resolves so older
    # conversations and links don't break.
    "workstation_calendar": "/kalender",
    "scheduler": "/scheduler",
    "fairness": "/fairness",
    "rotations": "/rotations",
    "user_profiles": "/user-profiles",
    "shifts": "/shifts",
    "workstations": "/workstations",
    "capabilities": "/capabilities",
    "planner_settings": "/planner-settings",
    "wish_settings": "/wish-settings",
    "audit_log": "/audit-log",
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
            page: One of: dashboard, schedule, day_view, employee_calendar,
                workstation_calendar, scheduler, fairness, rotations, user_profiles, shifts,
                workstations, capabilities, planner_settings, wish_settings, audit_log.
        """
        path = KNOWN_PAGES.get(page)
        if not path:
            return json.dumps({
                "error": f"Unknown page '{page}'. Valid pages: {', '.join(sorted(KNOWN_PAGES))}",
            })
        return json.dumps({"action": "navigate", "path": path})


# Keys of ConstraintConfig (planner/shift_planner/models.py) that may be
# overridden per call. Anything else in `constraints` is refused rather than
# silently ignored, so a typo doesn't look like a setting that had no effect.
OPTIMIZER_CONSTRAINT_KEYS = {
    "night_shift_recovery_days", "min_rest_hours", "max_consecutive_days",
    "max_working_days_per_week", "equality_weight", "priority_weights",
    "shift_continuity_weight", "shift_continuity_week_bonus",
    "monthly_hours_target_weight", "weekly_min_hours", "weekly_max_hours",
    "weekly_hours_target_weight", "preference_weight", "wish_weight",
    "skill_downgrade_weight", "fatigue_weight", "night_shift_fatigue_multiplier",
    "min_staffing_mode", "keep_fixed_assignments", "solver_time_limit_seconds",
    "solver_num_workers",
}


def _plan_summary(result: dict) -> dict:
    """Head-line numbers of a solver answer, without the plan itself."""
    assignments = 0
    scheduled = set()
    for plan in result.get("employee_plans") or []:
        for entry in plan.get("daily_plan") or []:
            if entry.get("status") == "assigned" and entry.get("shift_id"):
                assignments += 1
                scheduled.add(plan.get("employee_id"))
    return {
        "assignments": assignments,
        "employees_scheduled": len(scheduled),
        "employees_considered": len(result.get("employee_plans") or []),
        "days": len(result.get("schedule") or []),
    }


def _register_optimizer(mcp: FastMCP) -> None:
    """Add `optimizeSchedule` — run the CP-SAT solver and wait for its answer.

    The generated tools cover the backend's own planning endpoints, but those
    are asynchronous by design: `triggerPlan` queues a job on NATS and hands
    back a task id to poll, and the plan it eventually stores replaces nothing
    and keeps nothing. This tool is the synchronous counterpart — it builds the
    solver's input from the backend (`/planner/prepare`, the same payload
    `triggerPlan` would send), posts it straight to the optimizer service and
    returns the schedule it computes.

    Two arguments make it a *repair* tool rather than just a second way to
    plan: `locked_assignments` pins rows the caller wants kept, so the solver
    fills in around a plan instead of replacing it, and `constraints` relaxes
    or tightens a rule for this one run without touching the tenant's saved
    planner settings.
    """

    @mcp.tool
    async def optimizeSchedule(
        start_date: str,
        end_date: str,
        employee_ids: list[str] | None = None,
        constraints: dict | None = None,
        locked_assignments: list[dict] | None = None,
        include_plan: bool = False,
    ) -> str:
        """Run the shift optimizer (CP-SAT) for a period and return its schedule.

        Runs the solver now and waits for it, unlike triggerPlan. Nothing is
        stored: the answer comes back to you. Use it to try a plan out — with a
        rule relaxed, with part of an existing plan held fixed, or for a subset
        of the staff — before anything is written.

        Args:
            start_date: First day of the planning period, YYYY-MM-DD.
            end_date: Last day of the planning period, YYYY-MM-DD.
            employee_ids: Only plan for these employees. Omit for everyone.
            constraints: Per-run overrides of the tenant's planner settings,
                e.g. {"min_rest_hours": 10, "solver_time_limit_seconds": 30}.
                {"keep_fixed_assignments": false} plans as if there were no
                rotations — "what would the month look like without them?"
            locked_assignments: Rows the solver must keep, each
                {"employee_id", "date", "shift_id", "workstation_id"}. The
                solver plans around them; any that are impossible are reported
                in `message` instead of failing the run.
            include_plan: Return the full schedule as well as the summary.
                Off by default — a month for a whole ward is a large payload.
        """
        if constraints:
            unknown = sorted(set(constraints) - OPTIMIZER_CONSTRAINT_KEYS)
            if unknown:
                return json.dumps({
                    "error": f"Unknown constraint(s): {', '.join(unknown)}. "
                             f"Valid: {', '.join(sorted(OPTIMIZER_CONSTRAINT_KEYS))}",
                })

        request = {"start_date": start_date, "end_date": end_date}
        if employee_ids:
            request["employee_ids"] = employee_ids

        # The rules half comes from the backend as the signed-in user, so the
        # solve covers that tenant's ward and nobody else's.
        async with _client() as backend:
            try:
                prepared = await backend.post("/planner/prepare", json=request)
                prepared.raise_for_status()
                payload = prepared.json()
            except httpx.HTTPError as exc:
                logger.warning("preparePlan failed for %s..%s: %s", start_date, end_date, exc)
                return json.dumps({"error": f"Could not build the optimizer input: {exc}"})

        if constraints:
            payload["constraints"] = {**(payload.get("constraints") or {}), **constraints}
        if locked_assignments:
            payload["locked_assignments"] = locked_assignments

        url = f"{settings.optimizer_url.rstrip('/')}/api/v1/optimize"
        try:
            async with httpx.AsyncClient(timeout=settings.optimizer_timeout_seconds) as client:
                response = await client.post(url, json=payload)
        except httpx.HTTPError as exc:
            logger.warning("Optimizer at %s unreachable: %s", url, exc)
            return json.dumps({"error": f"The optimizer could not be reached: {exc}"})

        try:
            result = response.json()
        except ValueError:
            return json.dumps({"error": "The optimizer answered with something that is not JSON."})

        # 422 is the solver's own "no feasible plan" answer, which is a result,
        # not a transport failure — pass it through as one.
        if response.status_code >= 400 and result.get("status") not in ("infeasible", "validation_error"):
            return json.dumps({"error": f"The optimizer failed: {result.get('message') or response.status_code}"})

        answer = {
            "status": result.get("status"),
            "objective_value": result.get("objective_value"),
            "planning_period": result.get("planning_period"),
            "message": result.get("message"),
            "summary": _plan_summary(result),
        }
        if include_plan:
            answer["employee_plans"] = result.get("employee_plans") or []
            answer["schedule"] = result.get("schedule") or []
        return json.dumps(answer, default=str)


class TracingMiddleware(Middleware):
    """One span per tool call, named after the tool.

    The ASGI layer (see telemetry.asgi_middleware) already opens a server span
    for the HTTP request carrying the call and continues the agent's trace;
    this adds the tool name, which the transport can't know. The backend call
    the tool makes lands underneath, via httpx instrumentation.
    """

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        tool_name = getattr(context.message, "name", "unknown")
        with telemetry.span(
            f"mcp.tool {tool_name}",
            **{"mcp.tool.name": tool_name, "mcp.method.name": "tools/call"},
        ):
            return await call_next(context)


def build_mcp_server() -> FastMCP:
    mcp = FastMCP.from_openapi(
        openapi_spec=_load_openapi_spec(),
        client=_client(),
        name="Shift Backend API",
        auth=_build_auth(),
    )
    _register_navigation(mcp)
    _register_optimizer(mcp)
    if telemetry.enabled():
        mcp.add_middleware(TracingMiddleware())
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
