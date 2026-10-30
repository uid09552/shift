"""
The agent's own tools, served by the MCP server: the plan check, the repair,
the short-notice replacement search and the swap check.

They run the same engines as the agent's HTTP routes (agent/validation.py,
repair.py, replacement.py) — the scheduler page's *Verify Plan* / *Fix Plan*,
the Schedule page's *Find replacement…*, the backend's swap review — so an MCP
client (the chat agent, Claude Code, Claude Desktop) gets the answers those
pages get. The engines reach the backend through this server's own generated
tools, in process and as the MCP caller (mcp/inprocess.py).

What the HTTP routes add on top — a written summary of the report by a model —
is left out: an MCP client has its own model to explain the findings.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from fastmcp import FastMCP

from shift_agent.agent import repair, replacement, validation
from shift_agent.mcp.inprocess import InProcessTools

logger = logging.getLogger(__name__)

ENGINE_ERRORS = (validation.ValidationError, repair.RepairError)


class _LLMUnavailable(BaseException):
    """Raised out of the repair when the model that reads the instruction
    fails. A BaseException on purpose: the repair swallows ordinary exceptions
    from the model and carries on without the note — right for the *Fix Plan*
    button, wrong for an MCP caller who asked for something specific. This
    escapes that, before anything is written."""


class _StrictLLM:
    """A model whose failure stops the repair instead of being ignored."""

    def __init__(self, llm: Any) -> None:
        self._llm = llm

    def invoke(self, messages: Any) -> Any:
        try:
            return self._llm.invoke(messages)
        except Exception as exc:
            raise _LLMUnavailable(str(exc)) from exc


NO_LLM = (
    "The instruction could not be read: no language model is configured or "
    "reachable on the MCP server. Nothing was changed. Repair without an "
    "instruction, or retry once the model is available."
)


def _error(message: str) -> str:
    return json.dumps({"error": message})


def register_agent_tools(mcp: FastMCP, llm_provider: Callable[[], Any] | None = None) -> None:
    """Add the four tools. `llm_provider` builds the instruction reader on
    first need (shift_agent.llm.plain_llm unless a test passes its own)."""
    tools = InProcessTools(mcp)
    if llm_provider is None:
        from shift_agent.llm import plain_llm  # lazy: only an instruction needs a model

        llm_provider = plain_llm

    @mcp.tool
    async def validateOptimizedPlan(result_id: str) -> str:
        """Check a proposed (optimized) shift plan against the rules it was
        solved under and report every violation, counted exactly — the same
        report as the scheduler page's Verify Plan. Covers the hard rules (one
        shift a day, qualifications, absences, rest, recovery days, consecutive
        and weekly limits, staffing maximums, the labor-law profile) and the
        soft ones the solver may trade away (staffing minimums, preferred days
        off, hours targets). Nothing is written.

        Args:
            result_id: The stored optimizer result; listOptimizedShifts gives
                them, newest first.
        """

        def engine(call_mcp):
            rules, result, capability_names = validation.collect(call_mcp, result_id)
            report = validation.validate(rules, result, capability_names)
            report["result_id"] = result_id
            report["headline"] = validation.headline(report)
            return report

        try:
            return json.dumps(await tools.run(engine), default=str)
        except ENGINE_ERRORS as exc:
            return _error(str(exc))

    @mcp.tool
    async def repairOptimizedPlan(result_id: str, instruction: str = "", strategy: str = "repair") -> str:
        """Fix a proposed (optimized) shift plan and save the result — the same
        repair as the scheduler page's Fix Plan. Every row that breaks a hard
        rule is moved somewhere legal or removed, and short-staffed shifts are
        filled from whoever is free and qualified. Writes the plan: confirm
        with the user first.

        Args:
            result_id: The stored optimizer result to repair.
            instruction: The planner's own wishes, in their words ("Anna is
                off sick Thursday", "leave the night team alone"). Pass it
                verbatim. Needs the server's language model; without one a
                non-empty instruction is refused and nothing is saved.
            strategy: "repair" for local moves (seconds) or "resolve" to
                re-run the optimizer over the whole period, keeping what the
                planner pinned (minutes).
        """
        if strategy not in ("repair", "resolve"):
            return _error("strategy must be 'repair' or 'resolve'.")

        llm = None
        if instruction.strip():
            built = llm_provider()
            if built is None:
                return _error(NO_LLM)
            llm = _StrictLLM(built)

        def engine(call_mcp):
            report = repair.fix(call_mcp, result_id, instruction, strategy, llm=llm)
            # The findings are in before/after already; keep the change log.
            report["before"].pop("findings", None)
            return report

        try:
            return json.dumps(await tools.run(engine), default=str)
        except ENGINE_ERRORS as exc:
            return _error(str(exc))
        except _LLMUnavailable as exc:
            logger.warning("Instruction model failed for result %s: %s", result_id, exc)
            return _error(NO_LLM)

    @mcp.tool
    async def findReplacement(employee_id: str, date: str) -> str:
        """Who can take an absent person's confirmed shift on a day, ranked
        best first (wish, preferred day off, hours below target, rest), and
        why everyone else may not — the Schedule page's Find replacement….
        Nothing is written.

        Args:
            employee_id: The absent employee.
            date: The day, YYYY-MM-DD.
        """
        day = replacement._parse_day(date)
        if day is None:
            return _error("date must be YYYY-MM-DD.")
        try:
            return json.dumps(await tools.run(lambda call_mcp: replacement.search(call_mcp, employee_id, day)), default=str)
        except ENGINE_ERRORS as exc:
            return _error(str(exc))

    @mcp.tool
    async def checkShiftSwap(requester: dict, colleague: dict) -> str:
        """What a swap of two confirmed shifts would break: for each person,
        the shift they would take and every rule it breaks. Warnings for the
        planner, never a refusal; nothing is written.

        Args:
            requester: {"employee_id", "date"} of the person offering their shift.
            colleague: {"employee_id", "date"} of the colleague whose shift they want.
        """
        sides = []
        for name, side in (("requester", requester), ("colleague", colleague)):
            employee_id = (side or {}).get("employee_id")
            day = replacement._parse_day((side or {}).get("date"))
            if not isinstance(employee_id, str) or not employee_id or day is None:
                return _error(f"{name} needs employee_id and date (YYYY-MM-DD).")
            sides.append((employee_id, day))
        (rid, rday), (cid, cday) = sides
        try:
            return json.dumps(await tools.run(lambda call_mcp: replacement.check_swap(call_mcp, rid, rday, cid, cday)), default=str)
        except ENGINE_ERRORS as exc:
            return _error(str(exc))
