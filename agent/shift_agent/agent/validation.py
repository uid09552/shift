"""
Verifying a proposed shift plan against the rules it was supposed to satisfy.

The optimizer's answer is a proposal, not a promise: the plan a planner sees on
the scheduler page can be hand-edited afterwards, a solver run can be cut short
by its time limit, and the soft constraints are penalties rather than
guarantees. Before anyone presses **Take as Plan**, this module answers the
question the planner actually has — *does this plan break any of my rules?*

Two halves, and the split is the point:

  1. **The checks are arithmetic, not judgement.** Every hard constraint in
     `planner/shift_planner/optimizer.py` is re-derived here from the same
     inputs the solver got, in Python. A model asked to eyeball nine hundred
     assignments for an eleven-hour rest gap will miss some and invent others;
     counting them costs nothing and is exact. `validate()` never calls an LLM.

  2. **The explanation is the model's.** Turning "min_rest ×3, shift_over_max
     ×1" into something a ward manager can act on is language work, and that is
     what `narrate()` hands to the agent's LLM — with the findings already
     established, so it summarises rather than searches.

The rules come from `preparePlan`, the same backend endpoint that builds the
optimizer's input, so what is checked is exactly what was (or would be) solved:
the planning period, the shifts and their per-weekday times and staffing bands,
the workstations and their required skills, the employees with their skills,
available shifts and absences, and the tenant's constraint settings.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Callable

from langchain_core.tools import StructuredTool

logger = logging.getLogger(__name__)

# Backend operations this module drives, exposed by the MCP server from
# api/openapi.yaml. Named here so a spec rename fails loudly in one place.
RESULT_TOOL = "getOptimizedShift"
PREPARE_TOOL = "preparePlan"
CAPABILITY_TOOL = "listCapabilities"

# How many named examples each finding carries. Enough to recognise the
# pattern and go look, small enough to keep the report — and the prompt built
# from it — readable.
MAX_EXAMPLES = 5

# Defaults mirroring optimizer.py's _DEFAULT_CONSTRAINTS, for the fields the
# checks below actually use. A tenant that has never opened the planner
# settings page still gets validated against what the solver would have used.
_DEFAULT_CONSTRAINTS = {
    "night_shift_recovery_days": 2,
    "min_rest_hours": 11.0,
    "max_consecutive_days": 6,
    "max_working_days_per_week": 5,
}

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"


class ValidationError(Exception):
    """Something needed for the check could not be fetched or parsed."""


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    """All breaches of one rule, collapsed into a single entry.

    A plan that puts thirty people on a ten-hour turnaround is one problem, not
    thirty; the count carries the scale and the examples make it concrete.
    """

    rule: str
    severity: str
    title: str
    detail: str
    count: int = 0
    examples: list[str] = field(default_factory=list)

    def add(self, example: str) -> None:
        self.count += 1
        if len(self.examples) < MAX_EXAMPLES:
            self.examples.append(example)

    def as_dict(self) -> dict:
        payload = {
            "rule": self.rule,
            "severity": self.severity,
            "title": self.title,
            "detail": self.detail,
            "count": self.count,
            "examples": self.examples,
        }
        if self.count > len(self.examples):
            payload["more"] = self.count - len(self.examples)
        return payload


class _Findings:
    """Collects findings, one per rule, in the order the rules are checked."""

    def __init__(self) -> None:
        self._by_rule: dict[str, Finding] = {}

    def add(self, rule: str, severity: str, title: str, detail: str, example: str) -> None:
        finding = self._by_rule.get(rule)
        if finding is None:
            finding = Finding(rule=rule, severity=severity, title=title, detail=detail)
            self._by_rule[rule] = finding
        finding.add(example)

    def all(self) -> list[Finding]:
        # Errors first, then by how often each was broken: the report opens on
        # what would actually block the plan.
        return sorted(
            self._by_rule.values(),
            key=lambda f: (f.severity != SEVERITY_ERROR, -f.count),
        )


# ---------------------------------------------------------------------------
# Small helpers, kept identical to the solver's
# ---------------------------------------------------------------------------


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _date_range(start: date, end: date) -> list[date]:
    days = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


def workstation_closed(workstation: dict, day: date) -> bool:
    """Closed that day: deactivated (``available: false``), or inside one of its
    unavailability windows. preparePlan leaves deactivated stations out, so the
    flag only matters for rules that include them anyway."""
    if workstation.get("available") is False:
        return True
    for window in workstation.get("unavailability") or []:
        try:
            if _parse_date(window["from_date"]) <= day <= _parse_date(window["to_date"]):
                return True
        except (KeyError, TypeError, ValueError):
            continue
    return False


def _weekday(day: date) -> str:
    """The weekday key used throughout the optimizer contract: '0' = Monday."""
    return str(day.weekday())


def _minutes(value: str) -> int:
    parts = str(value).split(":")
    return int(parts[0]) * 60 + int(parts[1] if len(parts) > 1 else 0)


def _duration_hours(weekday_time: dict) -> float:
    start = _minutes(weekday_time["start_time"])
    end = _minutes(weekday_time["end_time"])
    if end > start:
        return (end - start) / 60.0
    return (24 * 60 - start + end) / 60.0


# ---------------------------------------------------------------------------
# Fetching the two halves
# ---------------------------------------------------------------------------


def _call_json(
    call_mcp: Callable[[str, dict], str], tool: str, arguments: dict, subject: str
) -> Any:
    """Call one MCP tool and parse its JSON, failing in the caller's language.

    ``subject`` names what was being fetched — the message reaches a planner
    looking at a dialog, for whom "getOptimizedShift failed" means nothing.
    """
    raw = call_mcp(tool, arguments)
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"{subject} came back in a form this check cannot read.") from exc
    if isinstance(payload, dict) and "error" in payload and len(payload) == 1:
        logger.warning("MCP tool %s failed: %s", tool, payload["error"])
        raise ValidationError(f"{subject} could not be loaded: {payload['error']}")
    return payload


def collect(
    call_mcp: Callable[[str, dict], str], result_id: str
) -> tuple[dict, dict, dict[str, str]]:
    """Fetch the proposed plan and the rules it has to hold against.

    Returns ``(rules, result, capability_names)`` — the ``preparePlan`` TaskDTO
    for the plan's own period, the stored optimizer result's ``result`` payload,
    and a capability id → name map, since the TaskDTO carries qualification ids
    only and "missing 3f2a…" tells a planner nothing.
    """
    # `resultId`, not `result_id`: MCP tool arguments carry the OpenAPI
    # parameter names verbatim, and this path parameter is camelCase in the spec.
    stored = _call_json(call_mcp, RESULT_TOOL, {"resultId": result_id}, "The proposed plan")
    if not isinstance(stored, dict):
        raise ValidationError(f"No optimizer result '{result_id}'.")
    result = stored.get("result") or stored
    period = result.get("planning_period") or {}
    if not period.get("start_date") or not period.get("end_date"):
        raise ValidationError("The stored result has no planning period to check against.")

    rules = _call_json(
        call_mcp,
        PREPARE_TOOL,
        {"start_date": period["start_date"], "end_date": period["end_date"]},
        "The rules for that period",
    )
    if not isinstance(rules, dict) or "employees" not in rules:
        raise ValidationError("Could not load the current rules for that period.")

    # Names are a nicety, not a requirement: a failure here costs readability,
    # not the check, so it must not fail the whole call.
    capability_names: dict[str, str] = {}
    try:
        # The endpoint pages at 50 by default; a ward's whole catalogue is small.
        catalog = _call_json(
            call_mcp, CAPABILITY_TOOL, {"limit": 500}, "The qualification list"
        )
        rows = catalog.get("data") if isinstance(catalog, dict) else catalog
        for row in rows or []:
            if isinstance(row, dict) and row.get("id"):
                capability_names[row["id"]] = row.get("name") or row["id"]
    except Exception:
        logger.warning("Could not load capability names for the validation report", exc_info=True)

    return rules, result, capability_names


# ---------------------------------------------------------------------------
# The plan, normalised
# ---------------------------------------------------------------------------


@dataclass
class Assignment:
    employee_id: str
    day: date
    shift_id: str
    workstation_id: str | None


def _assignments(result: dict) -> list[Assignment]:
    """One row per (employee, day) the plan puts someone on a shift.

    ``employee_plans`` is the authoritative side — it is what the scheduler
    page edits — and ``schedule`` is the same data grouped the other way.
    Prefer the former, fall back to the latter for results written before it
    existed. Rows without a shift ('free', 'unassigned') are not assignments.
    """
    rows: list[Assignment] = []
    for plan in result.get("employee_plans") or []:
        for entry in plan.get("daily_plan") or []:
            if entry.get("status") != "assigned" or not entry.get("shift_id"):
                continue
            try:
                day = _parse_date(entry["date"])
            except (KeyError, ValueError):
                continue
            rows.append(
                Assignment(
                    employee_id=plan.get("employee_id", ""),
                    day=day,
                    shift_id=entry["shift_id"],
                    workstation_id=entry.get("workstation_id"),
                )
            )
    if rows:
        return rows

    for day_entry in result.get("schedule") or []:
        for shift in day_entry.get("shifts") or []:
            for assignment in shift.get("assigned_dates") or []:
                try:
                    day = _parse_date(assignment.get("date") or day_entry["date"])
                except (KeyError, ValueError):
                    continue
                rows.append(
                    Assignment(
                        employee_id=assignment.get("employee_id", ""),
                        day=day,
                        shift_id=shift.get("shift_id", ""),
                        workstation_id=assignment.get("workstation_id"),
                    )
                )
    return rows


def compat_gap(employee: dict, workstation: dict, capabilities: dict) -> int | None:
    """Skill match between one employee and one workstation, with the solver's
    downgrade rule.

    A requirement is met by holding the capability, or by holding a
    higher-level one in the same ``skill_group`` (which the solver penalises
    but allows). The return value is the total number of levels over-qualified
    — 0 for an exact match — or ``None`` when the pair is incompatible, which
    is a hard breach. Shared with repair.py, which has to ask the same question
    about assignments that do not exist yet.
    """
    held = set(employee.get("skills") or [])
    total_gap = 0
    for required in workstation.get("required_skills") or []:
        if required in held:
            continue
        group = (capabilities.get(required) or {}).get("skill_group")
        if group is None:
            return None
        required_level = (capabilities.get(required) or {}).get("level", 1)
        best: int | None = None
        for capability in held:
            info = capabilities.get(capability) or {}
            if info.get("skill_group") != group:
                continue
            level = info.get("level", 1)
            if level >= required_level:
                gap = level - required_level
                best = gap if best is None else min(best, gap)
        if best is None:
            return None
        total_gap += best
    return total_gap


# ---------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------


class _Validator:
    """One validation run: the rules, the plan, and the findings between them.

    Each ``_check_*`` method mirrors one constraint of the CP-SAT model. Where
    the solver makes a rule soft (a penalty it may pay), the finding is a
    warning rather than an error — a plan that leaves a workstation one person
    short is worth seeing, but it is not invalid.
    """

    def __init__(
        self, rules: dict, result: dict, capability_names: dict[str, str] | None = None
    ) -> None:
        self.rules = rules
        self.result = result
        self.capability_names = capability_names or {}
        self.hours_by_employee: dict[str, float] = {}
        self.findings = _Findings()

        period = rules.get("planning_period") or result.get("planning_period") or {}
        try:
            self.start = _parse_date(period["start_date"])
            self.end = _parse_date(period["end_date"])
        except (KeyError, ValueError) as exc:
            raise ValidationError("The plan has no usable planning period.") from exc
        self.days = _date_range(self.start, self.end)

        cfg = dict(_DEFAULT_CONSTRAINTS)
        for key, value in (rules.get("constraints") or {}).items():
            if key in cfg and value is not None:
                cfg[key] = value
        self.cfg = cfg

        self.employees = {e["id"]: e for e in rules.get("employees") or []}
        self.shifts = {s["id"]: s for s in rules.get("shifts") or []}
        self.workstations = {w["id"]: w for w in rules.get("workstations") or []}
        self.capabilities = {c["id"]: c for c in rules.get("capabilities") or []}

        self.shift_wt = {
            (s["id"], wt["weekday"]): wt
            for s in self.shifts.values()
            for wt in s.get("weekday_times") or []
        }

        self.assignments = _assignments(result)
        # Who this run actually covered. A plan can be calculated for a subset of
        # the ward ("All Employees" on the scheduler page), while preparePlan
        # always describes the whole of it — so per-person checks that would
        # otherwise fire for everyone who simply wasn't in the run are scoped to
        # the people the result itself mentions.
        self.scope_ids = (
            {
                plan.get("employee_id")
                for plan in result.get("employee_plans") or []
                if plan.get("employee_id")
            }
            or {a.employee_id for a in self.assignments}
            or set(self.employees)
        )
        # (employee, day) -> assignments, so double bookings are visible rather
        # than silently collapsed.
        self.by_emp_day: dict[tuple[str, date], list[Assignment]] = defaultdict(list)
        self.days_by_employee: dict[str, set[date]] = defaultdict(set)
        for a in self.assignments:
            self.by_emp_day[(a.employee_id, a.day)].append(a)
            self.days_by_employee[a.employee_id].add(a.day)

    # -- naming ------------------------------------------------------------

    def _emp_name(self, employee_id: str) -> str:
        return (self.employees.get(employee_id) or {}).get("name") or employee_id

    def _shift_name(self, shift_id: str) -> str:
        return (self.shifts.get(shift_id) or {}).get("name") or shift_id

    def _capability_name(self, capability_id: str) -> str:
        return self.capability_names.get(capability_id, capability_id)

    def _ws_name(self, workstation_id: str | None) -> str:
        if not workstation_id:
            return "—"
        return (self.workstations.get(workstation_id) or {}).get("name") or workstation_id

    def _where(self, a: Assignment) -> str:
        return (
            f"{self._emp_name(a.employee_id)} · {a.day.isoformat()} · "
            f"{self._shift_name(a.shift_id)} · {self._ws_name(a.workstation_id)}"
        )

    # -- entry point -------------------------------------------------------

    def run(self) -> list[Finding]:
        self._check_known_entities()
        self._check_period()
        self._check_one_shift_per_day()
        self._check_eligibility()
        self._check_skills()
        self._check_staffing()
        self._check_recovery_days()
        self._check_weekly_days()
        self._check_min_rest()
        self._check_consecutive_days()
        self._check_preferences()
        self._check_hours()
        return self.findings.all()

    # -- the rules ---------------------------------------------------------

    def _check_known_entities(self) -> None:
        """Ids in the plan that no longer exist in the configuration.

        A plan outlives the data it was built from: someone deletes a
        workstation, and the stored result still points at it.
        """
        for a in self.assignments:
            if a.employee_id not in self.employees:
                self.findings.add(
                    "unknown_employee", SEVERITY_ERROR,
                    "Assigned to someone who is no longer in the plan's staff list",
                    "The plan assigns an employee the current configuration does not "
                    "contain — they were removed, or excluded from this planning run.",
                    f"{a.employee_id} · {a.day.isoformat()}",
                )
            if a.shift_id not in self.shifts:
                self.findings.add(
                    "unknown_shift", SEVERITY_ERROR,
                    "Assigned to a shift that no longer exists",
                    "The plan uses a shift the current configuration does not contain.",
                    f"{self._emp_name(a.employee_id)} · {a.day.isoformat()} · {a.shift_id}",
                )
            if a.workstation_id and a.workstation_id not in self.workstations:
                self.findings.add(
                    "unknown_workstation", SEVERITY_ERROR,
                    "Assigned to a deactivated or deleted workstation",
                    "The plan uses a workstation that is not planned any more — it was "
                    "deactivated, deleted, or has no active shifts.",
                    f"{self._emp_name(a.employee_id)} · {a.day.isoformat()} · {a.workstation_id}",
                )

    def _check_period(self) -> None:
        for a in self.assignments:
            if not (self.start <= a.day <= self.end):
                self.findings.add(
                    "outside_period", SEVERITY_ERROR,
                    "Assignment outside the planning period",
                    f"The plan covers {self.start.isoformat()} to {self.end.isoformat()}; "
                    "these assignments fall outside it.",
                    self._where(a),
                )

    def _check_one_shift_per_day(self) -> None:
        """Hard: at most one shift per employee per day (optimizer rule 3)."""
        for (employee_id, day), rows in self.by_emp_day.items():
            if len(rows) > 1:
                shifts = ", ".join(sorted({self._shift_name(r.shift_id) for r in rows}))
                self.findings.add(
                    "double_booking", SEVERITY_ERROR,
                    "Two shifts on the same day",
                    "Nobody may work more than one shift a day.",
                    f"{self._emp_name(employee_id)} · {day.isoformat()} · {shifts}",
                )

    def _check_eligibility(self) -> None:
        """Hard: the conditions under which the solver creates a variable at all
        — the shift runs that weekday, the employee may work it and is not
        away, the workstation runs that shift and is open."""
        for a in self.assignments:
            employee = self.employees.get(a.employee_id)
            shift = self.shifts.get(a.shift_id)
            if employee is None or shift is None:
                continue  # Already reported as an unknown entity.

            weekday = _weekday(a.day)
            if (a.shift_id, weekday) not in self.shift_wt:
                self.findings.add(
                    "shift_not_operating", SEVERITY_ERROR,
                    "Shift scheduled on a weekday it does not run",
                    "A shift only exists on the weekdays it has times configured for.",
                    self._where(a),
                )

            if a.shift_id not in set(employee.get("available_shifts") or []):
                self.findings.add(
                    "shift_not_available", SEVERITY_ERROR,
                    "Assigned to a shift the employee does not work",
                    "Employees may only be given shifts on their available-shifts list.",
                    self._where(a),
                )

            if a.day.isoformat() in set(employee.get("unavailability") or []):
                self.findings.add(
                    "employee_unavailable", SEVERITY_ERROR,
                    "Assigned on a day the employee is away",
                    "The employee has a hard absence on this date.",
                    self._where(a),
                )

            workstation = self.workstations.get(a.workstation_id or "")
            if workstation is None:
                continue

            if a.shift_id not in set(workstation.get("operating_shifts") or []):
                self.findings.add(
                    "workstation_shift_mismatch", SEVERITY_ERROR,
                    "Workstation does not run this shift",
                    "A workstation can only be staffed during the shifts it operates.",
                    self._where(a),
                )

            if workstation_closed(workstation, a.day):
                self.findings.add(
                    "workstation_unavailable", SEVERITY_ERROR,
                    "Workstation is closed on this date",
                    "The workstation is deactivated, or has a closure period covering this day.",
                    self._where(a),
                )

    def _compat_gap(self, employee_id: str, workstation_id: str) -> int | None:
        return compat_gap(
            self.employees.get(employee_id) or {},
            self.workstations.get(workstation_id) or {},
            self.capabilities,
        )

    def _check_skills(self) -> None:
        """Hard: an employee may only staff a workstation whose required skills
        they cover (directly, or by a same-group downgrade)."""
        for a in self.assignments:
            if not a.workstation_id or a.workstation_id not in self.workstations:
                continue
            if a.employee_id not in self.employees:
                continue
            gap = self._compat_gap(a.employee_id, a.workstation_id)
            if gap is None:
                held = set(self.employees[a.employee_id].get("skills") or [])
                missing = sorted(
                    self._capability_name(c)
                    for c in (self.workstations[a.workstation_id].get("required_skills") or [])
                    if c not in held
                )
                self.findings.add(
                    "missing_skills", SEVERITY_ERROR,
                    "Staffed by someone without the required qualification",
                    "The workstation requires capabilities the employee does not hold "
                    "and cannot cover from a higher level in the same skill group.",
                    f"{self._where(a)} — missing {', '.join(missing) or 'a required skill'}",
                )
            elif gap > 0:
                self.findings.add(
                    "skill_downgrade", SEVERITY_WARNING,
                    "Covered by a higher qualification than needed",
                    "Allowed, but the solver penalises it: someone over-qualified is "
                    "tied up where a lower level would do.",
                    self._where(a),
                )

    def _check_staffing(self) -> None:
        """Per-shift and per-workstation staffing bands.

        Maximums are hard in the solver; minimums are a penalty it may choose to
        pay, so a shortfall is a warning, not a breach.
        """
        per_shift: dict[tuple[date, str], int] = defaultdict(int)
        per_ws: dict[tuple[date, str, str], int] = defaultdict(int)
        for a in self.assignments:
            per_shift[(a.day, a.shift_id)] += 1
            if a.workstation_id:
                per_ws[(a.day, a.shift_id, a.workstation_id)] += 1

        for day in self.days:
            weekday = _weekday(day)
            for shift_id, shift in self.shifts.items():
                weekday_time = self.shift_wt.get((shift_id, weekday))
                if weekday_time is None:
                    continue
                staffed = per_shift.get((day, shift_id), 0)
                minimum = weekday_time.get("min_employees") or 0
                maximum = weekday_time.get("max_employees")
                label = f"{day.isoformat()} · {shift.get('name', shift_id)}"
                if maximum is not None and staffed > maximum:
                    self.findings.add(
                        "shift_over_max", SEVERITY_ERROR,
                        "More people on a shift than it allows",
                        "A shift's max_employees for that weekday is a hard limit.",
                        f"{label} — {staffed} of at most {maximum}",
                    )
                # With every station that runs the shift closed, there is nowhere
                # to put anyone, so the shift's own minimum does not apply.
                open_somewhere = any(
                    shift_id in set(w.get("operating_shifts") or []) and not workstation_closed(w, day)
                    for w in self.workstations.values()
                )
                if minimum and staffed < minimum and open_somewhere:
                    self.findings.add(
                        "shift_under_min", SEVERITY_WARNING,
                        "Shift below its minimum staffing",
                        "The solver treats the minimum as a strong penalty rather than a "
                        "hard rule, so it under-staffs when nobody eligible is left.",
                        f"{label} — {staffed} of {minimum} needed",
                    )

                for workstation_id, workstation in self.workstations.items():
                    if shift_id not in set(workstation.get("operating_shifts") or []):
                        continue
                    if workstation_closed(workstation, day):
                        continue
                    staffed_ws = per_ws.get((day, shift_id, workstation_id), 0)
                    ws_min = workstation.get("min_employees")
                    ws_min = 1 if ws_min is None else ws_min
                    ws_max = workstation.get("max_employees")
                    ws_label = (
                        f"{day.isoformat()} · {shift.get('name', shift_id)} · "
                        f"{workstation.get('name', workstation_id)}"
                    )
                    if ws_max is not None and staffed_ws > ws_max:
                        self.findings.add(
                            "workstation_over_max", SEVERITY_ERROR,
                            "More people at a workstation than it allows",
                            "A workstation's max_employees is a hard limit.",
                            f"{ws_label} — {staffed_ws} of at most {ws_max}",
                        )
                    if ws_min and staffed_ws < ws_min:
                        self.findings.add(
                            "workstation_under_min", SEVERITY_WARNING,
                            "Workstation below its minimum staffing",
                            "Left short by the solver — a penalty it paid, usually because "
                            "nobody qualified was still available.",
                            f"{ws_label} — {staffed_ws} of {ws_min} needed",
                        )

    def _check_recovery_days(self) -> None:
        """Hard: forced rest after a shift — ``free_days_after_shift``, or the
        tenant's ``night_shift_recovery_days`` for night shifts, whichever is
        larger."""
        night_recovery = self.cfg["night_shift_recovery_days"] or 0
        for a in self.assignments:
            shift = self.shifts.get(a.shift_id)
            weekday_time = self.shift_wt.get((a.shift_id, _weekday(a.day)))
            if shift is None or weekday_time is None:
                continue
            recovery = max(
                weekday_time.get("free_days_after_shift") or 0,
                night_recovery if shift.get("is_night_shift") else 0,
            )
            for offset in range(1, recovery + 1):
                following = a.day + timedelta(days=offset)
                if following > self.end:
                    break
                for other in self.by_emp_day.get((a.employee_id, following), []):
                    self.findings.add(
                        "recovery_day_violation", SEVERITY_ERROR,
                        "Working during a required recovery day",
                        f"{self._shift_name(a.shift_id)} owes {recovery} free day(s) "
                        "afterwards before the next shift.",
                        f"{self._emp_name(a.employee_id)} — {self._shift_name(a.shift_id)} on "
                        f"{a.day.isoformat()}, then {self._shift_name(other.shift_id)} on "
                        f"{following.isoformat()}",
                    )

    def _check_weekly_days(self) -> None:
        """Hard: maximum working days per week.

        The solver buckets weeks from the start of the planning period in
        blocks of seven days, not by calendar week, and this mirrors that so
        the two agree on where a week ends.
        """
        limit = self.cfg["max_working_days_per_week"] or 0
        if limit <= 0:
            return
        for employee_id, worked in self.days_by_employee.items():
            for offset in range(0, len(self.days), 7):
                block = self.days[offset : offset + 7]
                days_worked = sum(1 for day in block if day in worked)
                if days_worked > limit:
                    self.findings.add(
                        "max_weekly_days", SEVERITY_ERROR,
                        "More working days in a week than allowed",
                        f"At most {limit} working days per seven-day block, counted from "
                        "the start of the planning period.",
                        f"{self._emp_name(employee_id)} — {days_worked} days in "
                        f"{block[0].isoformat()}…{block[-1].isoformat()}",
                    )

    def _check_min_rest(self) -> None:
        """Hard: minimum rest between a shift and the next day's.

        Night shifts are excluded on the earlier day exactly as in the solver —
        their recovery days already keep the following day clear.
        """
        min_rest = self.cfg["min_rest_hours"] or 0
        if min_rest <= 0:
            return
        for (employee_id, day), rows in self.by_emp_day.items():
            following = day + timedelta(days=1)
            next_rows = self.by_emp_day.get((employee_id, following))
            if not next_rows:
                continue
            for first in rows:
                shift = self.shifts.get(first.shift_id)
                first_time = self.shift_wt.get((first.shift_id, _weekday(day)))
                if shift is None or first_time is None or shift.get("is_night_shift"):
                    continue
                end = _minutes(first_time["end_time"])
                for second in next_rows:
                    second_time = self.shift_wt.get((second.shift_id, _weekday(following)))
                    if second_time is None:
                        continue
                    rest = (24 * 60 - end + _minutes(second_time["start_time"])) / 60.0
                    if rest < min_rest:
                        self.findings.add(
                            "min_rest", SEVERITY_ERROR,
                            "Too little rest between two shifts",
                            f"At least {min_rest:g} hours are required between the end of one "
                            "shift and the start of the next.",
                            f"{self._emp_name(employee_id)} — {self._shift_name(first.shift_id)} "
                            f"on {day.isoformat()} to {self._shift_name(second.shift_id)} on "
                            f"{following.isoformat()}: {rest:.1f} h",
                        )

    def _check_consecutive_days(self) -> None:
        """Hard: maximum consecutive working days."""
        limit = self.cfg["max_consecutive_days"] or 0
        if limit <= 0:
            return
        for employee_id, days in self.days_by_employee.items():
            worked = sorted(days)
            streak_start = None
            previous = None
            for day in [*worked, None]:
                if previous is not None and (day is None or day != previous + timedelta(days=1)):
                    length = (previous - streak_start).days + 1
                    if length > limit:
                        self.findings.add(
                            "max_consecutive_days", SEVERITY_ERROR,
                            "Too many days worked in a row",
                            f"At most {limit} consecutive working days are allowed.",
                            f"{self._emp_name(employee_id)} — {length} days, "
                            f"{streak_start.isoformat()}…{previous.isoformat()}",
                        )
                    streak_start = day
                elif previous is None:
                    streak_start = day
                previous = day

    def _check_preferences(self) -> None:
        """Soft: the days people asked to have off. Never a breach — the solver
        pays a penalty and moves on — but a planner wants to see them."""
        for employee_id, employee in self.employees.items():
            if employee_id not in self.scope_ids:
                continue
            for preference in employee.get("preferred_off") or []:
                try:
                    day = _parse_date(preference["date"])
                except (KeyError, ValueError):
                    continue
                shift_id = preference.get("shift_id")
                for a in self.by_emp_day.get((employee_id, day), []):
                    if shift_id and a.shift_id != shift_id:
                        continue
                    self.findings.add(
                        "preferred_off_violated", SEVERITY_WARNING,
                        "Working on a day they asked to keep free",
                        "A soft preference the solver may override when it has to.",
                        self._where(a),
                    )

    def _check_hours(self) -> None:
        """Soft: hours worked against the employee's monthly target, scaled to
        the planning period the way the solver scales it (÷30 × days)."""
        if not self.days:
            return
        hours: dict[str, float] = defaultdict(float)
        for a in self.assignments:
            weekday_time = self.shift_wt.get((a.shift_id, _weekday(a.day)))
            if weekday_time is not None:
                hours[a.employee_id] += _duration_hours(weekday_time)
        self.hours_by_employee = dict(hours)
        for employee_id, employee in self.employees.items():
            if employee_id not in self.scope_ids:
                continue
            monthly = employee.get("monthly_working_hours") or 0
            if monthly <= 0:
                continue
            target = monthly * len(self.days) / 30.0
            actual = hours.get(employee_id, 0.0)
            deviation = actual - target
            # Two thresholds together: a relative one so small targets aren't
            # flagged for an hour, an absolute one so large ones aren't ignored.
            if abs(deviation) > max(8.0, target * 0.25):
                self.findings.add(
                    "hours_off_target", SEVERITY_WARNING,
                    "Well off the monthly hours target",
                    "Scaled to this planning period. The solver balances hours as a "
                    "soft objective, so a gap is a signal rather than a fault.",
                    f"{self._emp_name(employee_id)} — {actual:.1f} h against a target of "
                    f"{target:.1f} h ({deviation:+.1f} h)",
                )

    # -- statistics --------------------------------------------------------

    def stats(self) -> dict:
        wishes_total = 0
        wishes_met = 0
        for employee_id, employee in self.employees.items():
            if employee_id not in self.scope_ids:
                continue
            for wish in employee.get("wishes") or []:
                try:
                    day = _parse_date(wish["date"])
                except (KeyError, ValueError):
                    continue
                wishes_total += 1
                if any(
                    a.shift_id == wish.get("shift_id")
                    for a in self.by_emp_day.get((employee_id, day), [])
                ):
                    wishes_met += 1

        return {
            "days": len(self.days),
            "employees_in_scope": len(self.scope_ids),
            "employees_scheduled": len({a.employee_id for a in self.assignments}),
            "assignments": len(self.assignments),
            "hours_planned": round(sum(self.hours_by_employee.values()), 1),
            "wishes_total": wishes_total,
            "wishes_fulfilled": wishes_met,
        }


def validate(
    rules: dict, result: dict, capability_names: dict[str, str] | None = None
) -> dict:
    """Check one proposed plan against the rules. No LLM, no I/O."""
    validator = _Validator(rules, result, capability_names)
    findings = validator.run()

    errors = sum(f.count for f in findings if f.severity == SEVERITY_ERROR)
    warnings = sum(f.count for f in findings if f.severity == SEVERITY_WARNING)
    verdict = "invalid" if errors else ("issues" if warnings else "valid")

    return {
        "verdict": verdict,
        "planning_period": {
            "start_date": validator.start.isoformat(),
            "end_date": validator.end.isoformat(),
        },
        "solver_status": result.get("status"),
        "objective_value": result.get("objective_value"),
        "constraints": validator.cfg,
        "stats": validator.stats(),
        "error_count": errors,
        "warning_count": warnings,
        "findings": [f.as_dict() for f in findings],
    }


def headline(report: dict) -> str:
    """The verdict in one sentence, without asking a model for it.

    Used as the reply when no LLM is reachable, and as the fallback whenever
    narration fails — the check itself is still worth reporting.
    """
    stats = report.get("stats") or {}
    scope = (
        f"{stats.get('assignments', 0)} assignments over {stats.get('days', 0)} day(s) "
        f"for {stats.get('employees_scheduled', 0)} of {stats.get('employees_in_scope', 0)} people"
    )
    if report["verdict"] == "valid":
        return f"No rule violations found — {scope}."
    parts = []
    if report["error_count"]:
        parts.append(f"{report['error_count']} hard rule violation(s)")
    if report["warning_count"]:
        parts.append(f"{report['warning_count']} soft-rule warning(s)")
    return f"{' and '.join(parts)} across {scope}."


# ---------------------------------------------------------------------------
# The model's half: turning findings into something a planner can act on
# ---------------------------------------------------------------------------

NARRATION_PROMPT = """You are reviewing a proposed hospital shift plan for the \
planner who has to approve it.

The plan has already been checked mechanically against the ward's rules — every \
violation below was counted exactly, from the same data the optimizer was given. \
Do not re-derive them, doubt them, or invent any others.

Write a short review in markdown:
- Open with one sentence saying whether the plan can be confirmed as it stands.
- Then, for each finding, one bullet: what it is, how many, and what the planner \
can do about it (move someone, relax a setting, accept it). Name the people and \
dates from the examples where it helps.
- Errors are breaches of hard rules and must be fixed before confirming. Warnings \
are soft objectives the solver traded away — worth seeing, not blocking.
- If nothing was found, say so in one or two sentences and stop.

Be concrete and brief. No preamble, no headings above level 3, no raw JSON."""


def narrate(report: dict, llm: Any) -> str:
    """Ask the agent's LLM to explain the findings. Never raises.

    Falls back to :func:`headline` if there is no model configured or the call
    fails: a plain verdict beats an error where the whole point is to tell the
    planner what is wrong.
    """
    if llm is None:
        return headline(report)

    payload = {
        "verdict": report["verdict"],
        "planning_period": report["planning_period"],
        "solver_status": report.get("solver_status"),
        "settings_applied": report.get("constraints"),
        "statistics": report.get("stats"),
        "findings": report.get("findings"),
    }
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        response = llm.invoke([
            SystemMessage(content=NARRATION_PROMPT),
            HumanMessage(content=json.dumps(payload, indent=2, default=str)),
        ])
        text = (getattr(response, "content", "") or "").strip()
        return text or headline(report)
    except Exception:
        logger.exception("Plan validation narration failed — falling back to the plain verdict")
        return headline(report)


# ---------------------------------------------------------------------------
# Chat tool
# ---------------------------------------------------------------------------


def build_validation_tools(call_mcp: Callable[[str, dict], str]) -> list[StructuredTool]:
    """The plan check, as a tool the chat agent can call itself.

    The same check the scheduler page's button runs, so "is last night's plan
    OK?" in the chat and the button on the page cannot disagree. The tool
    returns the findings; the model does the explaining in its own reply, which
    is why nothing here calls an LLM.
    """

    def validate_optimized_plan(result_id: str) -> str:
        try:
            rules, result, capability_names = collect(call_mcp, result_id)
            report = validate(rules, result, capability_names)
        except ValidationError as exc:
            return json.dumps({"error": str(exc)})
        except Exception:
            logger.exception("Plan validation failed for result %s", result_id)
            return json.dumps({"error": "The plan could not be checked."})

        report["result_id"] = result_id
        report["headline"] = headline(report)
        return json.dumps(report, indent=2, default=str)

    return [
        StructuredTool.from_function(
            func=validate_optimized_plan,
            name="validateOptimizedPlan",
            description=(
                "Check a proposed (optimized) shift plan against the ward's rules and "
                "report every violation. Pass the optimizer result's id — "
                "listOptimizedShifts gives you those, newest first. The check is exact "
                "and covers the hard constraints (one shift a day, qualifications, "
                "absences, rest between shifts, recovery days, consecutive and weekly "
                "day limits, staffing maximums) plus the soft ones the solver may have "
                "traded away (staffing minimums, preferred days off, hours targets). "
                "Report what it returns; do not re-count or second-guess it."
            ),
        ),
    ]
