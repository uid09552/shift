"""
Short-notice replacement: "Anna is sick tomorrow — who can take her shift?"

The repair (repair.py) answers that question for a whole proposed plan. Here it
is asked for one slot of the *confirmed* roster, the one people are already
working to: the absent person's shift on one day. The answer is a ranked list,
not a move — the planner picks, because they know things the roster does not
(who was asked last time, who is on the phone).

The rules are the repair's own ``_Rules.blocking_reason``: every colleague the
solver could not have put there — away, unqualified, still recovering, too
little rest, too long a streak, over a personal limit — is left out, with the
reason, so "why not Ben?" has an answer. Everyone else is ranked:

  1. a shift wish for exactly that slot,
  2. not on one of their preferred days off,
  3. furthest below their hours for the month,
  4. most rest since their last shift.

Nothing here writes. The UI records the absence and the replacement through
the ordinary confirmed-plan endpoints once the planner has chosen; a
candidate's ``free_plan_id`` is their "free" row for that day, which has to
give way to the new shift (one row per person and day).
"""

from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta
from typing import Any, Callable

from shift_agent.agent.repair import RepairError, _Plan, _Rules
from shift_agent.agent.validation import (
    CAPABILITY_TOOL,
    PREPARE_TOOL,
    ValidationError,
    _call_json,
    _minutes,
)

logger = logging.getLogger(__name__)

ROSTER_TOOL = "listConfirmedShiftPlans"

# How far around the month the roster is read: recovery days, rest and streaks
# reach across the month's edges (the longest rule, max_consecutive_days, is at
# most 14 days).
_MARGIN_DAYS = 14


def _month(day: date) -> tuple[date, date]:
    last = calendar.monthrange(day.year, day.month)[1]
    return day.replace(day=1), day.replace(day=last)


def _load_roster(call_mcp: Callable[[str, dict], str], start: date, end: date) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        page = _call_json(
            call_mcp,
            ROSTER_TOOL,
            {"from_date": start.isoformat(), "to_date": end.isoformat(), "limit": 1000, "offset": offset},
            "The roster",
        )
        data = page.get("data") if isinstance(page, dict) else page
        data = [r for r in data or [] if isinstance(r, dict)]
        rows.extend(data)
        total = page.get("total") if isinstance(page, dict) else None
        offset += len(data)
        if not data or total is None or offset >= total:
            return rows


def collect(
    call_mcp: Callable[[str, dict], str], day: date
) -> tuple[dict, list[dict], dict[str, str]]:
    """The rules for the month of ``day`` (preparePlan), the confirmed roster
    around it, and capability names for readable reasons."""
    month_start, month_end = _month(day)
    rules = _call_json(
        call_mcp,
        PREPARE_TOOL,
        {"start_date": month_start.isoformat(), "end_date": month_end.isoformat()},
        "The rules for that month",
    )
    if not isinstance(rules, dict) or "employees" not in rules:
        raise ValidationError("Could not load the current rules for that month.")
    roster = _load_roster(
        call_mcp,
        month_start - timedelta(days=_MARGIN_DAYS),
        month_end + timedelta(days=_MARGIN_DAYS),
    )
    capability_names: dict[str, str] = {}
    try:
        catalog = _call_json(call_mcp, CAPABILITY_TOOL, {"limit": 500}, "The qualification list")
        for row in (catalog.get("data") if isinstance(catalog, dict) else catalog) or []:
            if isinstance(row, dict) and row.get("id"):
                capability_names[row["id"]] = row.get("name") or row["id"]
    except Exception:
        logger.warning("Could not load capability names for the replacement search", exc_info=True)
    return rules, roster, capability_names


def _parse_day(value: Any) -> date | None:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def find_replacements(
    rules: dict,
    roster: list[dict],
    employee_id: str,
    day: date,
    capability_names: dict[str, str] | None = None,
) -> dict:
    """Rank who may take ``employee_id``'s shift on ``day``.

    Raises ``RepairError`` when there is no shift of theirs on that day.
    """
    r = _Rules(rules, capability_names)
    plan = _Plan()
    absent_that_day: set[str] = set()
    # A "free" row is a planned day off, not an absence ("Take as Plan"
    # writes one for every day without a shift): whoever has one is free to
    # be asked, and the row has to make way for the new shift.
    free_rows: dict[str, str] = {}
    slot: dict | None = None
    for row in roster:
        row_day = _parse_day(row.get("date"))
        who = row.get("employee_id")
        if row_day is None or not who:
            continue
        if who == employee_id and row_day == day:
            if row.get("is_present", True) and row.get("shift_id"):
                slot = row
            continue  # they are out: their own cell is what is being replaced
        if not row.get("is_present", True) or not row.get("shift_id"):
            if row_day == day:
                if row.get("absence_type") in (None, "free"):
                    free_rows[who] = row.get("id")
                else:
                    absent_that_day.add(who)  # sick, on leave, away — not asked
            continue
        if plan.get(who, row_day) is None:
            plan.place(who, row_day, (row["shift_id"], row.get("workstation_id")))

    if slot is None:
        raise RepairError(
            f"{r.employee_name(employee_id)} has no shift on {day.isoformat()} to replace."
        )
    shift_id, workstation_id = slot["shift_id"], slot.get("workstation_id")
    month_start, month_end = _month(day)

    candidates: list[dict] = []
    unavailable: list[dict] = []
    for other_id, employee in r.employees.items():
        if other_id == employee_id:
            continue
        name = r.employee_name(other_id)
        if other_id in absent_that_day:
            unavailable.append({"employee_id": other_id, "name": name, "reason": "absent that day"})
            continue
        existing = plan.get(other_id, day)
        if existing is not None:
            unavailable.append({
                "employee_id": other_id, "name": name,
                "reason": f"already on {r.describe(existing)} that day",
            })
            continue
        reason = r.blocking_reason(other_id, day, shift_id, workstation_id, plan)
        if reason:
            unavailable.append({"employee_id": other_id, "name": name, "reason": reason})
            continue
        candidate = _candidate(r, plan, employee, other_id, day, shift_id, month_start, month_end)
        candidate["free_plan_id"] = free_rows.get(other_id)
        candidates.append(candidate)

    candidates.sort(key=lambda c: (
        not c["wished"], c["preferred_day_off"], -c["hours_below_target"],
        # No earlier shift in view counts as the most rested.
        -(c["rest_hours"] if c["rest_hours"] is not None else float("inf")),
        c["name"],
    ))
    for rank, candidate in enumerate(candidates, start=1):
        candidate["rank"] = rank
    unavailable.sort(key=lambda u: u["name"])

    # Who is still on that shift (at that station) without them, against the
    # minimum — a slot still at its minimum may need no replacement at all.
    weekday_time = r.weekday_time(shift_id, day) or {}
    if workstation_id:
        workstation = r.workstations.get(workstation_id) or {}
        staffed = plan.per_ws.get((day, shift_id, workstation_id), 0)
        minimum, maximum = workstation.get("min_employees"), workstation.get("max_employees")
    else:
        staffed = plan.per_shift.get((day, shift_id), 0)
        minimum, maximum = weekday_time.get("min_employees"), weekday_time.get("max_employees")

    return {
        "slot": {
            "date": day.isoformat(),
            "employee_id": employee_id,
            "employee_name": r.employee_name(employee_id),
            "plan_id": slot.get("id"),
            "shift_id": shift_id,
            "shift_name": r.shift_name(shift_id),
            "workstation_id": workstation_id,
            "workstation_name": r.workstation_name(workstation_id) if workstation_id else None,
            "hours": round(r.hours(shift_id, day), 1),
            "staffed_without": staffed,
            "min_employees": minimum,
            "max_employees": maximum,
        },
        "candidates": candidates,
        "unavailable": unavailable,
    }


def _candidate(
    r: _Rules, plan: _Plan, employee: dict, employee_id: str, day: date, shift_id: str,
    month_start: date, month_end: date,
) -> dict:
    worked = sorted(plan.days_by_employee.get(employee_id) or set())
    month_hours = sum(
        r.hours(plan.get(employee_id, d)[0], d) for d in worked if month_start <= d <= month_end
    )
    target = float(employee.get("monthly_working_hours") or 0)
    notes: list[str] = []

    # Rest since the end of their last shift before this one.
    rest_hours = None
    last_shift = None
    earlier = [d for d in worked if d < day]
    start_time = r.weekday_time(shift_id, day)
    if earlier:
        last_day = earlier[-1]
        last_shift = last_day.isoformat()
        previous_time = r.weekday_time(plan.get(employee_id, last_day)[0], last_day)
        if previous_time and start_time:
            end = _minutes(previous_time["end_time"])
            if end <= _minutes(previous_time["start_time"]):
                end += 24 * 60  # ran past midnight
            begin = (day - last_day).days * 24 * 60 + _minutes(start_time["start_time"])
            rest_hours = round((begin - end) / 60.0, 1)

    wished = any(
        _parse_day(w.get("date")) == day and w.get("shift_id") == shift_id
        for w in employee.get("wishes") or []
    )
    preferred_off = str(day.weekday()) in (employee.get("preferred_days_off") or []) or any(
        _parse_day(p.get("date")) == day and p.get("shift_id") in (None, shift_id)
        for p in employee.get("preferred_off") or []
    )
    if wished:
        notes.append("wished for this shift")
    if preferred_off:
        notes.append("would rather have this day off")
    if target and month_hours + r.hours(shift_id, day) > target:
        notes.append("goes over their monthly hours")

    return {
        "employee_id": employee_id,
        "name": r.employee_name(employee_id),
        "month_hours": round(month_hours, 1),
        "target_hours": round(target, 1) if target else None,
        "hours_below_target": round(target - month_hours, 1) if target else 0.0,
        "last_shift": last_shift,
        "rest_hours": rest_hours,
        "wished": wished,
        "preferred_day_off": preferred_off,
        "notes": notes,
    }


def search(call_mcp: Callable[[str, dict], str], employee_id: str, day: date) -> dict:
    rules, roster, capability_names = collect(call_mcp, day)
    return find_replacements(rules, roster, employee_id, day, capability_names)
