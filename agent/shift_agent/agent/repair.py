"""
Fixing a proposed shift plan — the other half of validation.py.

Checking a plan tells the planner what is wrong with it. That is where the
answer used to stop: the findings came back, and moving people around to
resolve them was the planner's own afternoon. This module does that part, and
it splits the work the same way validation.py does, for the same reason:

  1. **The moves are arithmetic, not judgement.** ``Repairer`` re-derives every
     hard constraint of the CP-SAT model (via ``_Rules.blocking_reason``) and
     only ever places somebody where the solver could have placed them. A model
     asked to reshuffle nine hundred assignments would produce something that
     reads well and breaks the rest week; deciding each move by counting costs
     nothing and cannot. Nothing here calls an LLM.

  2. **The user's sentence is the model's.** "Anna can't work Thursdays, and
     give the ICU one more person on nights" is language, and turning it into
     concrete instructions is what ``parse_instruction`` hands to the LLM — as
     a *translation* task with the vocabulary in front of it (the ward's
     employees, shifts and workstations), not as a scheduling task. Whatever
     comes back is checked against the rules like any other move, and is
     refused with a reason when it does not hold.

Two strategies, and the caller picks:

  - **repair** (default) — local moves, in one pass over the plan. Every row
    that breaks a hard rule is relocated if there is a legal place for it on
    the same day and cleared if there is not, and the gaps left behind (plus
    whatever was already understaffed) are filled from whoever is free and
    qualified. Seconds, and it never touches a row that was already fine.
  - **resolve** — hand the whole period back to the CP-SAT solver through the
    MCP server's ``optimizeSchedule`` tool, locking what the user asked to keep
    so their decisions survive the re-solve. Minutes, and the answer is
    globally optimal rather than locally patched.

The result is written back through ``updateOptimizedShift`` — the same endpoint
the scheduler page's own edits go through — and re-checked with
:func:`validation.validate`, so the report the planner sees afterwards is
produced by the same counting as the one that sent them here.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable

from langchain_core.tools import StructuredTool

from shift_agent.agent.validation import (
    ValidationError,
    _assignments,
    _date_range,
    _duration_hours,
    _minutes,
    _parse_date,
    _weekday,
    collect,
    compat_gap,
    validate,
    workstation_closed,
)
from shift_agent.agent.validation import headline as validation_headline

logger = logging.getLogger(__name__)

# Backend operations this module drives, exposed by the MCP server. The first
# two are generated from api/openapi.yaml; optimizeSchedule is the MCP server's
# own tool (mcp/server.py) — the synchronous way into the CP-SAT solver.
UPDATE_TOOL = "updateOptimizedShift"
OPTIMIZE_TOOL = "optimizeSchedule"

# Ceiling on feasibility checks in the fill pass. A month for a large ward is
# days × shifts × workstations × employees, which is worth bounding: a repair
# runs while a planner waits on a dialog.
MAX_FILL_ATTEMPTS = 200_000


class RepairError(Exception):
    """The plan could not be repaired or written back."""


# ---------------------------------------------------------------------------
# What the user asked for
# ---------------------------------------------------------------------------


@dataclass
class Directives:
    """The user's free-text note, turned into things that can be checked.

    Everything is optional, and an empty instance — what an empty note or an
    unreachable model produces — means "just fix what is broken".
    """

    # [{"employee_id", "date"}] — clear whatever is planned there.
    unassign: list[dict] = field(default_factory=list)
    # [{"employee_id", "date", "shift_id", "workstation_id"?}] — place this.
    assign: list[dict] = field(default_factory=list)
    # Employee ids whose assignments the repair must not touch.
    protect_employees: list[str] = field(default_factory=list)
    # Per-run optimizer overrides, only used by the resolve strategy.
    constraints: dict = field(default_factory=dict)
    # The user asked for a full re-solve rather than a patch.
    resolve: bool = False
    # What the model made of the note, for the report.
    understood: str = ""


INSTRUCTION_PROMPT = """You translate a shift planner's note into instructions a \
scheduling tool can execute. You are not scheduling anything yourself — you are \
only saying, in structured form, what the planner asked for.

Answer with one JSON object and nothing else:

{
  "unassign":  [{"employee": "<name or id>", "date": "YYYY-MM-DD"}],
  "assign":    [{"employee": "<name or id>", "date": "YYYY-MM-DD",
                 "shift": "<name or id>", "workstation": "<name or id, optional>"}],
  "protect":   ["<employee name or id>"],
  "constraints": {"<optimizer setting>": <number>},
  "resolve": false,
  "understood": "<one sentence, the planner's own words back to them>"
}

Rules:
- Use only the employees, shifts, workstations and dates listed below. Never \
invent one. Leave a list empty when the note says nothing about it.
- "take X off <date>" / "X is sick on <date>" -> unassign.
- "put X on the late shift on <date>" -> assign.
- "don't change Y's roster" / "leave Y alone" -> protect.
- "plan it again", "re-optimize", "start the optimizer" -> "resolve": true.
- A named rule the planner wants relaxed for this run goes in constraints, using \
the exact setting name: night_shift_recovery_days, min_rest_hours, \
max_consecutive_days, max_working_days_per_week, wish_weight, \
min_staffing_mode ("soft"/"hard"), personal_limits_mode ("soft"/"hard"), \
equality_weight, preference_weight.
- A date the note gives loosely ("Thursday") must be resolved to a date inside \
the planning period; if it is ambiguous, leave it out rather than guessing.
- If the note only describes what is wrong without asking for anything \
specific, return empty lists — the repair fixes the violations by itself."""


def _match_id(text: str, catalog: dict[str, dict]) -> str | None:
    """Resolve a name the model wrote back to an id in the ward's data.

    Exact id, then exact name, then unique case-insensitive substring — and
    nothing at all when two people could be meant, since acting on the wrong
    one is worse than reporting that the note was unclear.
    """
    if not text:
        return None
    needle = str(text).strip()
    if needle in catalog:
        return needle
    lowered = needle.lower()
    by_name = [i for i, row in catalog.items() if (row.get("name") or "").lower() == lowered]
    if len(by_name) == 1:
        return by_name[0]
    partial = [i for i, row in catalog.items() if lowered in (row.get("name") or "").lower()]
    return partial[0] if len(partial) == 1 else None


def parse_instruction(instruction: str, rules: dict, llm: Any) -> Directives:
    """Turn the planner's note into directives. Never raises.

    A note that cannot be parsed, or a model that is not reachable, yields
    empty directives — the repair then does what it would have done anyway,
    which is better than refusing to run.
    """
    if not (instruction or "").strip():
        return Directives()

    employees = {e["id"]: e for e in rules.get("employees") or []}
    shifts = {s["id"]: s for s in rules.get("shifts") or []}
    workstations = {w["id"]: w for w in rules.get("workstations") or []}
    period = rules.get("planning_period") or {}

    if llm is None:
        logger.info("No LLM available — the instruction is ignored, the repair still runs")
        return Directives()

    vocabulary = {
        "planning_period": period,
        "employees": sorted((e.get("name") or e["id"]) for e in employees.values()),
        "shifts": sorted((s.get("name") or s["id"]) for s in shifts.values()),
        "workstations": sorted((w.get("name") or w["id"]) for w in workstations.values()),
    }

    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        response = llm.invoke([
            SystemMessage(content=INSTRUCTION_PROMPT),
            HumanMessage(content=json.dumps(
                {"note": instruction, "available": vocabulary}, indent=2, default=str
            )),
        ])
        raw = (getattr(response, "content", "") or "").strip()
        payload = _loads_object(raw)
    except Exception:
        logger.exception("Could not read the planner's instruction — repairing without it")
        return Directives()

    if not isinstance(payload, dict):
        return Directives()

    directives = Directives(
        resolve=bool(payload.get("resolve")),
        understood=str(payload.get("understood") or "").strip(),
    )

    for row in payload.get("unassign") or []:
        employee_id = _match_id((row or {}).get("employee", ""), employees)
        day = _safe_date((row or {}).get("date"))
        if employee_id and day:
            directives.unassign.append({"employee_id": employee_id, "date": day})

    for row in payload.get("assign") or []:
        row = row or {}
        employee_id = _match_id(row.get("employee", ""), employees)
        shift_id = _match_id(row.get("shift", ""), shifts)
        day = _safe_date(row.get("date"))
        if not (employee_id and shift_id and day):
            continue
        directives.assign.append({
            "employee_id": employee_id,
            "date": day,
            "shift_id": shift_id,
            "workstation_id": _match_id(row.get("workstation", ""), workstations),
        })

    for name in payload.get("protect") or []:
        employee_id = _match_id(name, employees)
        if employee_id:
            directives.protect_employees.append(employee_id)

    constraints = payload.get("constraints")
    if isinstance(constraints, dict):
        directives.constraints = {k: v for k, v in constraints.items() if v is not None}

    return directives


def _loads_object(text: str) -> Any:
    """Parse the JSON object out of a model reply, fenced or not."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    return json.loads(text[start : end + 1])


def _safe_date(value: Any) -> date | None:
    try:
        return _parse_date(str(value))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# The plan, as something that can be changed
# ---------------------------------------------------------------------------

# One assignment: the shift, and the workstation it is at (None for a row that
# names no station — the solver always names one, hand edits need not).
Cell = tuple[str, str | None]


@dataclass
class Change:
    """One thing the repair did, in terms the planner can check."""

    action: str  # "cleared" | "moved" | "added"
    rule: str  # the finding it answers, "instruction", or "fill"
    employee_id: str
    day: date
    before: str | None
    after: str | None
    text: str

    def as_dict(self) -> dict:
        return {
            "action": self.action,
            "rule": self.rule,
            "employee_id": self.employee_id,
            "date": self.day.isoformat(),
            "before": self.before,
            "after": self.after,
            "text": self.text,
        }


class _Plan:
    """The working copy: one cell per (employee, day), with the counts that
    every staffing check needs kept up to date as it changes."""

    def __init__(self) -> None:
        self.cells: dict[tuple[str, date], Cell] = {}
        self.per_shift: dict[tuple[date, str], int] = defaultdict(int)
        self.per_ws: dict[tuple[date, str, str], int] = defaultdict(int)
        self.days_by_employee: dict[str, set[date]] = defaultdict(set)

    def get(self, employee_id: str, day: date) -> Cell | None:
        return self.cells.get((employee_id, day))

    def place(self, employee_id: str, day: date, cell: Cell) -> None:
        if (employee_id, day) in self.cells:
            self.clear(employee_id, day)
        shift_id, workstation_id = cell
        self.cells[(employee_id, day)] = cell
        self.per_shift[(day, shift_id)] += 1
        if workstation_id:
            self.per_ws[(day, shift_id, workstation_id)] += 1
        self.days_by_employee[employee_id].add(day)

    def clear(self, employee_id: str, day: date) -> Cell | None:
        cell = self.cells.pop((employee_id, day), None)
        if cell is None:
            return None
        shift_id, workstation_id = cell
        self.per_shift[(day, shift_id)] -= 1
        if workstation_id:
            self.per_ws[(day, shift_id, workstation_id)] -= 1
        self.days_by_employee[employee_id].discard(day)
        return cell


# ---------------------------------------------------------------------------
# The rules, as a question that can be asked of a single move
# ---------------------------------------------------------------------------


class _Rules:
    """The ward's configuration, indexed for one question: *may this person work
    this shift here on this day, given everything else in the plan?*

    Every clause mirrors a hard constraint of the CP-SAT model in
    ``planner/shift_planner/optimizer.py`` — the same ones validation.py counts
    after the fact. Soft objectives (staffing minimums, preferred days off,
    hours targets) are deliberately absent: they are what the repair is trying
    to improve, not what it is forbidden to break.
    """

    def __init__(self, rules: dict, capability_names: dict[str, str] | None = None) -> None:
        period = rules.get("planning_period") or {}
        try:
            self.start = _parse_date(period["start_date"])
            self.end = _parse_date(period["end_date"])
        except (KeyError, ValueError) as exc:
            raise RepairError("The plan has no usable planning period.") from exc
        self.days = _date_range(self.start, self.end)

        self.employees = {e["id"]: e for e in rules.get("employees") or []}
        self.shifts = {s["id"]: s for s in rules.get("shifts") or []}
        self.workstations = {w["id"]: w for w in rules.get("workstations") or []}
        self.capabilities = {c["id"]: c for c in rules.get("capabilities") or []}
        self.capability_names = capability_names or {}

        self.shift_wt = {
            (s["id"], wt["weekday"]): wt
            for s in self.shifts.values()
            for wt in s.get("weekday_times") or []
        }

        cfg = {
            "night_shift_recovery_days": 2,
            "min_rest_hours": 11.0,
            "max_consecutive_days": 6,
            "max_working_days_per_week": 5,
            "personal_limits_mode": "hard",
        }
        for key, value in (rules.get("constraints") or {}).items():
            if key in cfg and value is not None:
                cfg[key] = value
        self.cfg = cfg

        self.unavailable = {
            eid: {d for d in (e.get("unavailability") or [])}
            for eid, e in self.employees.items()
        }
        self.available_shifts = {
            eid: set(e.get("available_shifts") or []) for eid, e in self.employees.items()
        }
        self._compat: dict[tuple[str, str], int | None] = {}

    # -- naming ------------------------------------------------------------

    def employee_name(self, employee_id: str) -> str:
        return (self.employees.get(employee_id) or {}).get("name") or employee_id

    def shift_name(self, shift_id: str | None) -> str:
        if not shift_id:
            return "—"
        return (self.shifts.get(shift_id) or {}).get("name") or shift_id

    def workstation_name(self, workstation_id: str | None) -> str:
        if not workstation_id:
            return "—"
        return (self.workstations.get(workstation_id) or {}).get("name") or workstation_id

    def describe(self, cell: Cell | None) -> str | None:
        if cell is None:
            return None
        shift_id, workstation_id = cell
        if workstation_id:
            return f"{self.shift_name(shift_id)} · {self.workstation_name(workstation_id)}"
        return self.shift_name(shift_id)

    # -- pieces of the question --------------------------------------------

    def compat(self, employee_id: str, workstation_id: str) -> int | None:
        key = (employee_id, workstation_id)
        if key not in self._compat:
            self._compat[key] = compat_gap(
                self.employees.get(employee_id) or {},
                self.workstations.get(workstation_id) or {},
                self.capabilities,
            )
        return self._compat[key]

    def weekday_time(self, shift_id: str, day: date) -> dict | None:
        return self.shift_wt.get((shift_id, _weekday(day)))

    def recovery_days(self, shift_id: str, day: date) -> int:
        """Free days owed after working this shift on this day."""
        weekday_time = self.weekday_time(shift_id, day)
        if weekday_time is None:
            return 0
        night = self.cfg["night_shift_recovery_days"] or 0
        return max(
            weekday_time.get("free_days_after_shift") or 0,
            night if (self.shifts.get(shift_id) or {}).get("is_night_shift") else 0,
        )

    def hours(self, shift_id: str, day: date) -> float:
        weekday_time = self.weekday_time(shift_id, day)
        return _duration_hours(weekday_time) if weekday_time else 0.0

    def workstation_open(self, workstation_id: str, day: date) -> bool:
        return not workstation_closed(self.workstations.get(workstation_id) or {}, day)

    def eligible(self, employee_id: str, day: date, shift_id: str, workstation_id: str | None) -> str | None:
        """The half of the question that does not depend on the rest of the plan
        — exactly the conditions under which the solver creates a variable."""
        if employee_id not in self.employees:
            return "not in this plan's staff list"
        if shift_id not in self.shifts:
            return "unknown shift"
        if not (self.start <= day <= self.end):
            return "outside the planning period"
        if self.weekday_time(shift_id, day) is None:
            return f"{self.shift_name(shift_id)} does not run on that weekday"
        if shift_id not in self.available_shifts.get(employee_id, set()):
            return f"does not work the {self.shift_name(shift_id)}"
        if day.isoformat() in self.unavailable.get(employee_id, set()):
            return "away that day"
        if (
            (self.employees.get(employee_id) or {}).get("no_night_shifts")
            and (self.shifts.get(shift_id) or {}).get("is_night_shift")
        ):
            return "does not work night shifts (personal limit)"
        if workstation_id is None:
            return None
        workstation = self.workstations.get(workstation_id)
        if workstation is None:
            return "unknown workstation"
        if shift_id not in set(workstation.get("operating_shifts") or []):
            return f"{self.workstation_name(workstation_id)} does not run that shift"
        if not self.workstation_open(workstation_id, day):
            return f"{self.workstation_name(workstation_id)} is closed that day"
        if self.compat(employee_id, workstation_id) is None:
            missing = sorted(
                self.capability_names.get(c, c)
                for c in (workstation.get("required_skills") or [])
                if c not in set((self.employees.get(employee_id) or {}).get("skills") or [])
            )
            return f"lacks {', '.join(missing) or 'a required qualification'}"
        return None

    def blocking_reason(
        self, employee_id: str, day: date, shift_id: str, workstation_id: str | None, plan: _Plan
    ) -> str | None:
        """Why this assignment may not be made, or None if it may.

        The employee must have nothing else planned that day — the caller
        clears the cell first when it is re-placing one.
        """
        reason = self.eligible(employee_id, day, shift_id, workstation_id)
        if reason:
            return reason

        if plan.get(employee_id, day) is not None:
            return "already has a shift that day"

        # Staffing maximums — hard in the solver, both per shift and per station.
        weekday_time = self.weekday_time(shift_id, day)
        maximum = (weekday_time or {}).get("max_employees")
        if maximum is not None and plan.per_shift.get((day, shift_id), 0) + 1 > maximum:
            return f"{self.shift_name(shift_id)} is already full on {day.isoformat()}"
        if workstation_id:
            ws_max = (self.workstations.get(workstation_id) or {}).get("max_employees")
            if ws_max is not None and plan.per_ws.get((day, shift_id, workstation_id), 0) + 1 > ws_max:
                return f"{self.workstation_name(workstation_id)} is already full on {day.isoformat()}"

        worked = plan.days_by_employee.get(employee_id) or set()

        # Recovery days, in both directions: what this shift owes afterwards,
        # and what an earlier shift still owes on this day.
        for offset in range(1, self.recovery_days(shift_id, day) + 1):
            if (day + timedelta(days=offset)) in worked:
                return f"owes {self.recovery_days(shift_id, day)} recovery day(s) afterwards"
        for offset in range(1, 8):
            earlier = day - timedelta(days=offset)
            cell = plan.get(employee_id, earlier)
            if cell and self.recovery_days(cell[0], earlier) >= offset:
                return f"still recovering from the {self.shift_name(cell[0])} on {earlier.isoformat()}"

        # Minimum rest to the day before and the day after. Night shifts are
        # excluded on the earlier side, as in the solver — their recovery days
        # already keep the following day clear.
        min_rest = self.cfg["min_rest_hours"] or 0
        if min_rest > 0 and weekday_time is not None:
            previous = plan.get(employee_id, day - timedelta(days=1))
            if previous and not (self.shifts.get(previous[0]) or {}).get("is_night_shift"):
                earlier_time = self.weekday_time(previous[0], day - timedelta(days=1))
                if earlier_time is not None:
                    rest = (
                        24 * 60 - _minutes(earlier_time["end_time"])
                        + _minutes(weekday_time["start_time"])
                    ) / 60.0
                    if rest < min_rest:
                        return f"only {rest:.1f} h rest after the previous day's shift"
            following = plan.get(employee_id, day + timedelta(days=1))
            if following and not (self.shifts.get(shift_id) or {}).get("is_night_shift"):
                later_time = self.weekday_time(following[0], day + timedelta(days=1))
                if later_time is not None:
                    rest = (
                        24 * 60 - _minutes(weekday_time["end_time"])
                        + _minutes(later_time["start_time"])
                    ) / 60.0
                    if rest < min_rest:
                        return f"only {rest:.1f} h rest before the next day's shift"

        # Consecutive days: the streak this day would join, both sides.
        limit = self.cfg["max_consecutive_days"] or 0
        if limit > 0:
            streak = 1
            probe = day - timedelta(days=1)
            while probe in worked:
                streak += 1
                probe -= timedelta(days=1)
            probe = day + timedelta(days=1)
            while probe in worked:
                streak += 1
                probe += timedelta(days=1)
            if streak > limit:
                return f"would be {streak} working days in a row (limit {limit})"

        # Personal night / weekend caps per calendar month — hard only in
        # hard personal_limits_mode; in soft mode the solver may go over.
        reason = self._personal_limit_reason(employee_id, day, shift_id, plan)
        if reason:
            return reason

        # Working days per seven-day block, counted from the start of the
        # period exactly as the solver buckets them.
        weekly = self.cfg["max_working_days_per_week"] or 0
        if weekly > 0:
            offset = (day - self.start).days // 7 * 7
            block = self.days[offset : offset + 7]
            if sum(1 for d in block if d in worked) + 1 > weekly:
                return f"would be more than {weekly} working days in that week"

        return None


    def _personal_limit_reason(
        self, employee_id: str, day: date, shift_id: str, plan: _Plan
    ) -> str | None:
        if self.cfg["personal_limits_mode"] != "hard":
            return None
        employee = self.employees.get(employee_id) or {}
        worked = [
            d for d in plan.days_by_employee.get(employee_id) or set()
            if (d.year, d.month) == (day.year, day.month)
        ]
        max_nights = employee.get("max_nights_per_month")
        if max_nights is not None and (self.shifts.get(shift_id) or {}).get("is_night_shift"):
            nights = sum(
                1 for d in worked
                if (self.shifts.get((plan.get(employee_id, d) or ("", None))[0]) or {}).get("is_night_shift")
            )
            if nights + 1 > max_nights:
                return f"would be more than {max_nights} night shifts this month (personal limit)"
        max_weekends = employee.get("max_weekends_per_month")
        if max_weekends is not None and day.weekday() >= 5:
            saturday = day - timedelta(days=day.weekday() - 5)
            weekends = {
                d - timedelta(days=d.weekday() - 5)
                for d in plan.days_by_employee.get(employee_id) or set()
                if d.weekday() >= 5
            }
            weekends = {s for s in weekends if (s.year, s.month) == (saturday.year, saturday.month)}
            if saturday not in weekends and len(weekends) + 1 > max_weekends:
                return f"would be more than {max_weekends} weekends this month (personal limit)"
        return None


# ---------------------------------------------------------------------------
# The repair
# ---------------------------------------------------------------------------


class Repairer:
    """One repair run: the rules, the plan, the user's directives, the changes.

    ``run()`` leaves the plan free of hard-rule violations — every row it could
    not make legal is cleared rather than left standing — and then fills what
    it can of the staffing minimums, including the gaps it has just made.
    """

    def __init__(self, rules: dict, result: dict, directives: Directives | None = None,
                 capability_names: dict[str, str] | None = None) -> None:
        self.rules = _Rules(rules, capability_names)
        self.result = result
        self.directives = directives or Directives()
        self.changes: list[Change] = []
        self.rejected: list[str] = []
        self.protected: set[tuple[str, date]] = set()

        self.plan = _Plan()
        self.dropped: list[tuple[str, date]] = []
        for assignment in _assignments(result):
            if self.plan.get(assignment.employee_id, assignment.day) is not None:
                # A second shift on the same day: keep the first, the rest are
                # the double booking validation.py reports.
                self.dropped.append((assignment.employee_id, assignment.day))
                self._record(
                    "cleared", "double_booking", assignment.employee_id, assignment.day,
                    self.rules.describe((assignment.shift_id, assignment.workstation_id)), None,
                    "second shift on the same day removed",
                )
                continue
            self.plan.place(
                assignment.employee_id, assignment.day,
                (assignment.shift_id, assignment.workstation_id),
            )

        # Hours worked so far, so the fill pass hands work to whoever has least.
        self.hours: dict[str, float] = defaultdict(float)
        for (employee_id, day), (shift_id, _) in self.plan.cells.items():
            self.hours[employee_id] += self.rules.hours(shift_id, day)

    # -- bookkeeping --------------------------------------------------------

    def _record(self, action: str, rule: str, employee_id: str, day: date,
                before: str | None, after: str | None, why: str) -> None:
        name = self.rules.employee_name(employee_id)
        if action == "cleared":
            text = f"{name} · {day.isoformat()} — removed {before or 'the assignment'} ({why})"
        elif action == "moved":
            text = f"{name} · {day.isoformat()} — {before} → {after} ({why})"
        else:
            text = f"{name} · {day.isoformat()} — added {after} ({why})"
        self.changes.append(Change(action, rule, employee_id, day, before, after, text))

    def _place(self, employee_id: str, day: date, cell: Cell) -> None:
        self.plan.place(employee_id, day, cell)
        self.hours[employee_id] += self.rules.hours(cell[0], day)

    def _clear(self, employee_id: str, day: date) -> Cell | None:
        cell = self.plan.clear(employee_id, day)
        if cell is not None:
            self.hours[employee_id] -= self.rules.hours(cell[0], day)
        return cell

    def _is_protected(self, employee_id: str, day: date) -> bool:
        return employee_id in self.directives.protect_employees or (employee_id, day) in self.protected

    # -- the passes ---------------------------------------------------------

    def run(self) -> None:
        self._apply_directives()
        self._fix_violations()
        self._fill_shortfalls()

    def _apply_directives(self) -> None:
        """What the planner asked for, before anything is decided automatically.

        Their instructions win over the repair's own judgement, so what they
        set is pinned for the rest of the run — but never over the rules: an
        instruction that cannot be carried out comes back as a refusal with the
        reason, not as a plan that breaks.
        """
        for row in self.directives.unassign:
            employee_id, day = row["employee_id"], row["date"]
            cell = self._clear(employee_id, day)
            self.protected.add((employee_id, day))
            if cell is None:
                continue
            self._record(
                "cleared", "instruction", employee_id, day,
                self.rules.describe(cell), None, "you asked for it",
            )

        for row in self.directives.assign:
            employee_id, day = row["employee_id"], row["date"]
            shift_id, workstation_id = row["shift_id"], row.get("workstation_id")
            before = self.rules.describe(self.plan.get(employee_id, day))
            previous = self._clear(employee_id, day)

            cell = self._best_placement(employee_id, day, shift_id, workstation_id)
            if cell is None:
                if previous is not None:
                    self._place(employee_id, day, previous)
                reason = (
                    self.rules.eligible(employee_id, day, shift_id, workstation_id)
                    or "there is no room for it without breaking another rule"
                )
                self.rejected.append(
                    f"{self.rules.employee_name(employee_id)} · {day.isoformat()} · "
                    f"{self.rules.shift_name(shift_id)}: {reason}"
                )
                continue

            self._place(employee_id, day, cell)
            self.protected.add((employee_id, day))
            self._record(
                "moved" if before else "added", "instruction", employee_id, day,
                before, self.rules.describe(cell), "you asked for it",
            )

    def _best_placement(
        self, employee_id: str, day: date, shift_id: str, workstation_id: str | None
    ) -> Cell | None:
        """A legal cell for this employee on this shift, at the station asked
        for if it holds, otherwise at the one that needs the person most."""
        if workstation_id is not None:
            if self.rules.blocking_reason(employee_id, day, shift_id, workstation_id, self.plan) is None:
                return (shift_id, workstation_id)
            return None
        candidates = []
        for candidate_id in self.rules.workstations:
            if self.rules.blocking_reason(employee_id, day, shift_id, candidate_id, self.plan) is not None:
                continue
            candidates.append((self._shortfall(day, shift_id, candidate_id), candidate_id))
        if not candidates:
            return None
        candidates.sort(key=lambda row: (-row[0], row[1]))
        return (shift_id, candidates[0][1])

    def _shortfall(self, day: date, shift_id: str, workstation_id: str) -> int:
        """How many people this station is still short of its minimum, weighted
        by the station's priority so the important ones are staffed first."""
        workstation = self.rules.workstations.get(workstation_id) or {}
        minimum = workstation.get("min_employees")
        minimum = 1 if minimum is None else minimum
        short = max(0, minimum - self.plan.per_ws.get((day, shift_id, workstation_id), 0))
        weight = {"high": 3, "medium": 2, "low": 1}.get(workstation.get("priority"), 1)
        return short * weight

    def _fix_violations(self) -> None:
        """One pass over the plan: every row that breaks a hard rule is moved
        somewhere legal, or removed.

        Order matters only in who yields to whom — where two rows break a rule
        *against each other* (too little rest between them), the first one
        checked is the one that moves, and the second is then fine where it is.
        Removing an assignment can never break a hard rule, so one pass is
        enough to leave none behind.
        """
        for (employee_id, day) in sorted(self.plan.cells, key=lambda key: (key[1], key[0])):
            # Pinned by the planner: left exactly as it is, even when it breaks
            # something. "Leave the night team alone" outranks tidiness, and the
            # report says plainly what is still open afterwards.
            if self._is_protected(employee_id, day):
                continue
            cell = self.plan.get(employee_id, day)
            if cell is None:
                continue
            shift_id, workstation_id = cell

            self.plan.clear(employee_id, day)
            reason = self.rules.blocking_reason(employee_id, day, shift_id, workstation_id, self.plan)
            if reason is None:
                self.plan.place(employee_id, day, cell)
                continue
            self.hours[employee_id] -= self.rules.hours(shift_id, day)

            replacement = self._relocate(employee_id, day, shift_id)
            if replacement is not None:
                self._place(employee_id, day, replacement)
                self._record(
                    "moved", _rule_for(reason), employee_id, day,
                    self.rules.describe(cell), self.rules.describe(replacement), reason,
                )
            else:
                self._record(
                    "cleared", _rule_for(reason), employee_id, day,
                    self.rules.describe(cell), None, reason,
                )

    def _relocate(self, employee_id: str, day: date, shift_id: str) -> Cell | None:
        """Somewhere else for this person on this day — the same shift at
        another station first, since keeping the shift keeps the day's rhythm,
        and only then a different shift."""
        cell = self._best_placement(employee_id, day, shift_id, None)
        if cell is not None:
            return cell
        for other_shift in self.rules.shifts:
            if other_shift == shift_id:
                continue
            cell = self._best_placement(employee_id, day, other_shift, None)
            if cell is not None:
                return cell
        return None

    def _fill_shortfalls(self) -> None:
        """Staff what is still below its minimum, from whoever is free.

        The solver treats a minimum as a penalty it may pay, so a shortfall is
        not a broken rule — but it is the thing a planner most wants closed,
        and after the pass above there are fresh gaps where people were taken
        out. Stations are served in priority order, and each opening goes to
        the eligible person with the fewest hours so far, which is the same
        fairness objective the solver optimises.
        """
        attempts = 0
        order = sorted(
            (
                (day, shift_id, workstation_id)
                for day in self.rules.days
                for shift_id in self.rules.shifts
                for workstation_id in self.rules.workstations
            ),
            key=lambda row: (row[0], -_priority_rank(self.rules.workstations.get(row[2]) or {})),
        )
        for day, shift_id, workstation_id in order:
            if attempts > MAX_FILL_ATTEMPTS:
                logger.info("Fill pass stopped at %d attempts", attempts)
                return
            workstation = self.rules.workstations.get(workstation_id) or {}
            if self.rules.weekday_time(shift_id, day) is None:
                continue
            if shift_id not in set(workstation.get("operating_shifts") or []):
                continue
            if not self.rules.workstation_open(workstation_id, day):
                continue
            while self._shortfall(day, shift_id, workstation_id) > 0:
                candidates: list[tuple[float, str]] = []
                for employee_id in self.rules.employees:
                    attempts += 1
                    if self.plan.get(employee_id, day) is not None or self._is_protected(employee_id, day):
                        continue
                    if self.rules.blocking_reason(employee_id, day, shift_id, workstation_id, self.plan):
                        continue
                    candidates.append((self.hours.get(employee_id, 0.0), employee_id))
                if not candidates:
                    break
                candidates.sort()
                employee_id = candidates[0][1]
                self._place(employee_id, day, (shift_id, workstation_id))
                self._record(
                    "added", "fill", employee_id, day, None,
                    self.rules.describe((shift_id, workstation_id)),
                    f"{self.rules.workstation_name(workstation_id)} was below its minimum",
                )

    # -- the repaired plan --------------------------------------------------

    def rebuilt(self) -> dict:
        """The stored result, with the plan replaced and everything else kept.

        Both views are rewritten — ``employee_plans``, which the scheduler page
        edits, and ``schedule``, which is the same data grouped by day — so the
        two cannot drift apart. Fields this module has no opinion about
        (``status``, ``objective_value``, ``employee_summary``) are carried
        over untouched.
        """
        result = dict(self.result)

        plans: list[dict] = []
        seen: set[str] = set()
        for existing in self.result.get("employee_plans") or []:
            employee_id = existing.get("employee_id")
            if not employee_id:
                continue
            seen.add(employee_id)
            plans.append({
                "employee_id": employee_id,
                "employee_name": existing.get("employee_name")
                or self.rules.employee_name(employee_id),
                "daily_plan": self._daily_plan(employee_id),
            })
        for employee_id in sorted({eid for eid, _ in self.plan.cells} - seen):
            plans.append({
                "employee_id": employee_id,
                "employee_name": self.rules.employee_name(employee_id),
                "daily_plan": self._daily_plan(employee_id),
            })

        result["employee_plans"] = plans
        result["schedule"] = self._schedule()
        return result

    def _daily_plan(self, employee_id: str) -> list[dict]:
        rows = []
        for day in self.rules.days:
            cell = self.plan.get(employee_id, day)
            if cell is None:
                rows.append({"date": day.isoformat(), "status": "free"})
                continue
            shift_id, workstation_id = cell
            rows.append({
                "date": day.isoformat(),
                "status": "assigned",
                "shift_id": shift_id,
                "shift_name": self.rules.shift_name(shift_id),
                "workstation_id": workstation_id,
                "workstation_name": self.rules.workstation_name(workstation_id)
                if workstation_id else None,
            })
        return rows

    def _schedule(self) -> list[dict]:
        by_day: dict[date, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
        for (employee_id, day), (shift_id, workstation_id) in self.plan.cells.items():
            by_day[day][shift_id].append({
                "date": day.isoformat(),
                "employee_id": employee_id,
                "employee_name": self.rules.employee_name(employee_id),
                "workstation_id": workstation_id,
                "workstation_name": self.rules.workstation_name(workstation_id)
                if workstation_id else None,
            })
        schedule = []
        for day in self.rules.days:
            if day not in by_day:
                continue
            schedule.append({
                "date": day.isoformat(),
                "weekday": day.strftime("%A").lower(),
                "shifts": [
                    {
                        "shift_id": shift_id,
                        "shift_name": self.rules.shift_name(shift_id),
                        "assigned_dates": sorted(rows, key=lambda row: row["employee_name"]),
                    }
                    for shift_id, rows in sorted(by_day[day].items())
                ],
            })
        return schedule


def _priority_rank(workstation: dict) -> int:
    return {"high": 3, "medium": 2, "low": 1}.get(workstation.get("priority"), 1)


# Blocking reasons, mapped back onto the finding they answer, so the change log
# and the validation report speak about the same rules.
_RULE_PATTERNS = [
    ("away that day", "employee_unavailable"),
    ("does not work the", "shift_not_available"),
    ("does not run on that weekday", "shift_not_operating"),
    ("does not run that shift", "workstation_shift_mismatch"),
    ("is closed that day", "workstation_unavailable"),
    ("lacks", "missing_skills"),
    ("not in this plan's staff list", "unknown_employee"),
    ("unknown shift", "unknown_shift"),
    ("unknown workstation", "unknown_workstation"),
    ("outside the planning period", "outside_period"),
    ("is already full", "shift_over_max"),
    ("recovery day", "recovery_day_violation"),
    ("still recovering", "recovery_day_violation"),
    ("rest", "min_rest"),
    ("days in a row", "max_consecutive_days"),
    ("working days in that week", "max_weekly_days"),
]


def _rule_for(reason: str) -> str:
    lowered = reason.lower()
    for needle, rule in _RULE_PATTERNS:
        if needle in lowered:
            return rule
    return "other"


# ---------------------------------------------------------------------------
# Re-solving instead of patching
# ---------------------------------------------------------------------------


def resolve_with_optimizer(
    call_mcp: Callable[[str, dict], str],
    rules: dict,
    result: dict,
    directives: Directives,
    locked: list[dict],
) -> tuple[dict, str | None]:
    """Hand the period back to the CP-SAT solver, keeping what must be kept.

    Only what the planner pinned is locked — their explicit instructions, and
    the rows they asked to leave alone. Everything else is the solver's to
    decide again, which is the point of asking it: a plan patched row by row is
    locally legal, and a plan solved whole is good.
    """
    period = rules.get("planning_period") or result.get("planning_period") or {}
    arguments: dict[str, Any] = {
        "start_date": str(period.get("start_date")),
        "end_date": str(period.get("end_date")),
        "include_plan": True,
    }
    scope = [plan.get("employee_id") for plan in result.get("employee_plans") or []]
    scope = [employee_id for employee_id in scope if employee_id]
    if scope and len(scope) < len(rules.get("employees") or []):
        arguments["employee_ids"] = scope
    if locked:
        arguments["locked_assignments"] = locked
    if directives.constraints:
        arguments["constraints"] = directives.constraints

    raw = call_mcp(OPTIMIZE_TOOL, arguments)
    try:
        answer = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise RepairError("The optimizer answered in a form this step cannot read.") from exc
    if not isinstance(answer, dict) or answer.get("error"):
        raise RepairError(
            (answer or {}).get("error") if isinstance(answer, dict) else "The optimizer call failed."
        )
    if answer.get("status") not in ("optimal", "feasible"):
        raise RepairError(
            answer.get("message")
            or "The optimizer found no plan that satisfies the rules as they stand."
        )

    rebuilt = dict(result)
    rebuilt["employee_plans"] = answer.get("employee_plans") or []
    rebuilt["schedule"] = answer.get("schedule") or []
    rebuilt["status"] = answer.get("status")
    if answer.get("objective_value") is not None:
        rebuilt["objective_value"] = answer["objective_value"]
    return rebuilt, answer.get("message")


def locks_from_directives(directives: Directives, plan_result: dict) -> list[dict]:
    """The rows a re-solve has to keep: what the planner pinned, as the
    optimizer's ``locked_assignments``."""
    pinned: list[dict] = []
    protect = set(directives.protect_employees)
    wanted = {(row["employee_id"], row["date"]) for row in directives.assign}
    for plan in plan_result.get("employee_plans") or []:
        employee_id = plan.get("employee_id")
        for entry in plan.get("daily_plan") or []:
            if entry.get("status") != "assigned" or not entry.get("shift_id"):
                continue
            if not entry.get("workstation_id"):
                continue  # The solver can only lock a full (shift, station) row.
            day = _safe_date(entry.get("date"))
            if day is None:
                continue
            if employee_id in protect or (employee_id, day) in wanted:
                pinned.append({
                    "employee_id": employee_id,
                    "date": day.isoformat(),
                    "shift_id": entry["shift_id"],
                    "workstation_id": entry["workstation_id"],
                })
    return pinned


# ---------------------------------------------------------------------------
# The whole thing
# ---------------------------------------------------------------------------


def fix(
    call_mcp: Callable[[str, dict], str],
    result_id: str,
    instruction: str = "",
    strategy: str = "repair",
    llm: Any = None,
    persist: bool = True,
) -> dict:
    """Check a plan, fix what is wrong with it, and write it back.

    Args:
        call_mcp: the MCP call used for every backend operation, so the whole
            thing runs as the signed-in user.
        result_id: the stored optimizer result to repair.
        instruction: the planner's own note, in their words. Optional.
        strategy: ``repair`` for local moves, ``resolve`` to re-run the solver.
            A note asking for a re-solve promotes ``repair`` to ``resolve``.
        llm: the model that reads the note, and None to ignore it.
        persist: write the repaired plan back. False checks what would happen.

    Returns the report the caller shows: the verdict before and after, what was
    changed, and what was asked for but could not be done.
    """
    rules, result, capability_names = collect(call_mcp, result_id)
    before = validate(rules, result, capability_names)

    directives = parse_instruction(instruction, rules, llm)
    if directives.resolve and strategy == "repair":
        strategy = "resolve"

    repairer = Repairer(rules, result, directives, capability_names)
    repairer.run()
    repaired = repairer.rebuilt()
    note = None

    if strategy == "resolve":
        # The locks come from the repaired plan, so an instruction the planner
        # gave in this same call is already in it and survives the re-solve.
        locked = locks_from_directives(directives, repaired)
        repaired, note = resolve_with_optimizer(call_mcp, rules, result, directives, locked)

    after = validate(rules, repaired, capability_names)
    # Shaped exactly like a /plan/validate response, so the page can put it
    # straight back into the panel the Verify button filled.
    after["result_id"] = result_id
    after["headline"] = validation_headline(after)

    if persist:
        _persist(call_mcp, result_id, repaired)

    report = {
        "result_id": result_id,
        "strategy": strategy,
        "persisted": persist,
        "instruction": instruction,
        "understood": directives.understood,
        "before": _verdict(before),
        "after": after,
        "changes": [change.as_dict() for change in repairer.changes] if strategy == "repair" else [],
        "change_count": len(repairer.changes) if strategy == "repair" else None,
        "rejected": repairer.rejected,
        "optimizer_note": note,
    }
    report["headline"] = fix_headline(report)
    return report


def _verdict(report: dict) -> dict:
    """The parts of a validation report worth keeping as a "before" picture."""
    return {
        "verdict": report["verdict"],
        "error_count": report["error_count"],
        "warning_count": report["warning_count"],
        "findings": report.get("findings"),
        "stats": report.get("stats"),
    }


def _persist(call_mcp: Callable[[str, dict], str], result_id: str, repaired: dict) -> None:
    """Write the repaired plan back, through the same endpoint the scheduler
    page's own edits use."""
    # employee_summary is required by the spec's TaskResultDto and is not
    # something this module computes — carry over whatever the result had.
    payload = {"resultId": result_id, "employee_summary": [], **repaired}
    raw = call_mcp(UPDATE_TOOL, payload)
    try:
        answer = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        raise RepairError("The repaired plan could not be saved.")
    if isinstance(answer, dict) and answer.get("error") and len(answer) == 1:
        raise RepairError(f"The repaired plan could not be saved: {answer['error']}")


def fix_headline(report: dict) -> str:
    """What happened, in one sentence, without asking a model for it."""
    before, after = report["before"], report["after"]
    if report["strategy"] == "resolve":
        opening = "Re-solved the period."
    else:
        count = report.get("change_count") or 0
        opening = f"Changed {count} assignment(s)." if count else "Nothing needed changing."
    fixed = before["error_count"] - after["error_count"]
    parts = []
    if fixed > 0:
        parts.append(f"{fixed} hard violation(s) resolved")
    if after["error_count"]:
        parts.append(f"{after['error_count']} still open")
    warnings_fixed = before["warning_count"] - after["warning_count"]
    if warnings_fixed > 0:
        parts.append(f"{warnings_fixed} warning(s) cleared")
    if report.get("rejected"):
        parts.append(f"{len(report['rejected'])} instruction(s) could not be carried out")
    return f"{opening} " + (", ".join(parts) + "." if parts else "The plan is unchanged in substance.")


NARRATION_PROMPT = """You are reporting back to the planner who asked you to fix a \
proposed hospital shift plan.

The work is already done: the changes below were made by rule, each one checked \
against the same constraints the optimizer solves under. Do not re-derive them, \
doubt them, or suggest the plan still needs the moves that were already made.

Write a short report in markdown:
- Open with one sentence: what you did, and whether the plan can be confirmed now.
- Then the changes, grouped by what they fixed — say how many and name a few \
people and dates. Do not list all of them.
- If anything the planner asked for was refused, say so plainly and why.
- If violations remain, say which and what the planner's options are (relax a \
setting, add staff, accept it).
- No preamble, no headings above level 3, no raw JSON."""


def narrate(report: dict, llm: Any) -> str:
    """Ask the LLM to write the repair up. Never raises — falls back to the
    plain headline, since the fix itself is still worth reporting."""
    if llm is None:
        return fix_headline(report)
    payload = {
        "strategy": report["strategy"],
        "the_planner_asked_for": report.get("instruction") or None,
        "understood_as": report.get("understood") or None,
        "before": {
            "verdict": report["before"]["verdict"],
            "errors": report["before"]["error_count"],
            "warnings": report["before"]["warning_count"],
            "findings": report["before"].get("findings"),
        },
        "changes_made": [change["text"] for change in report.get("changes") or []][:60],
        "changes_total": report.get("change_count"),
        "could_not_do": report.get("rejected"),
        "after": {
            "verdict": report["after"]["verdict"],
            "errors": report["after"]["error_count"],
            "warnings": report["after"]["warning_count"],
            "findings": report["after"].get("findings"),
        },
    }
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        response = llm.invoke([
            SystemMessage(content=NARRATION_PROMPT),
            HumanMessage(content=json.dumps(payload, indent=2, default=str)),
        ])
        text = (getattr(response, "content", "") or "").strip()
        return text or fix_headline(report)
    except Exception:
        logger.exception("Repair narration failed — falling back to the plain headline")
        return fix_headline(report)


# ---------------------------------------------------------------------------
# Chat tool
# ---------------------------------------------------------------------------


def build_repair_tools(
    call_mcp: Callable[[str, dict], str], llm_provider: Callable[[], Any] | None = None
) -> list[StructuredTool]:
    """The repair, as a tool the chat agent can call itself.

    The same code the scheduler page's **Fix** button runs, so "sort last
    night's plan out" in the chat and the button cannot disagree about what a
    fix means. The tool returns what it did; the model explains it in its own
    reply, which is why nothing here narrates.
    """

    def repair_optimized_plan(
        result_id: str, instruction: str = "", strategy: str = "repair"
    ) -> str:
        llm = llm_provider() if llm_provider else None
        try:
            report = fix(call_mcp, result_id, instruction, strategy, llm=llm)
        except (ValidationError, RepairError) as exc:
            return json.dumps({"error": str(exc)})
        except Exception:
            logger.exception("Plan repair failed for result %s", result_id)
            return json.dumps({"error": "The plan could not be repaired."})
        # The findings are already in the report's before/after; the change log
        # is what the model has to talk about, so keep it and trim the rest.
        report["before"].pop("findings", None)
        return json.dumps(report, indent=2, default=str)

    return [
        StructuredTool.from_function(
            func=repair_optimized_plan,
            name="repairOptimizedPlan",
            description=(
                "Fix a proposed (optimized) shift plan and save the result. Pass the "
                "optimizer result's id — listOptimizedShifts gives you those, newest "
                "first. Every row that breaks a hard rule is moved somewhere legal or "
                "removed, and understaffed shifts are filled from whoever is free and "
                "qualified. `instruction` carries the user's own wishes in their words "
                "('take Anna off Thursday', 'nobody new on nights') — pass it through "
                "verbatim rather than interpreting it. `strategy` is 'repair' for local "
                "moves (seconds) or 'resolve' to re-run the CP-SAT optimizer over the "
                "whole period (minutes, better plan, keeps only what the user pinned). "
                "The plan is written back, so confirm with the user before calling it."
            ),
        ),
    ]
