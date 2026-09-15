"""Minimum staffing: the solver fills every slot it can before it optimises
anything else, and names the slots it cannot fill."""

import pytest

from shift_planner.optimizer import solve

# Mon 2026-09-07 … Fri 2026-09-11
PERIOD = {"start_date": "2026-09-07", "end_date": "2026-09-11"}
WEEKDAYS = ["0", "1", "2", "3", "4"]


def _shift(sid, start="08:00", end="16:00", min_employees=1, weekdays=WEEKDAYS):
    return {
        "id": sid,
        "name": sid.title(),
        "is_night_shift": False,
        "weekday_times": [
            {"weekday": wd, "start_time": start, "end_time": end, "min_employees": min_employees}
            for wd in weekdays
        ],
    }


def _ws(wid, priority="medium", skills=("care",), shifts=("day",), min_employees=1):
    return {
        "id": wid,
        "name": wid.upper(),
        "required_skills": list(skills),
        "priority": priority,
        "operating_shifts": list(shifts),
        "min_employees": min_employees,
    }


def _emp(eid, skills=("care",), shifts=("day",), unavailability=()):
    return {
        "id": eid,
        "name": eid.title(),
        "skills": list(skills),
        "available_shifts": list(shifts),
        "unavailability": list(unavailability),
    }


def _input(shifts, workstations, employees, **constraints):
    return {
        "planning_period": PERIOD,
        "shifts": shifts,
        "workstations": workstations,
        "employees": employees,
        "constraints": {"solver_time_limit_seconds": 10, "solver_num_workers": 4, **constraints},
    }


def _staffed(result):
    """{(date, shift_id, workstation_id): headcount}"""
    counts = {}
    for day in result.schedule:
        for shift in day.shifts:
            for a in shift.assigned_dates:
                key = (str(day.date), shift.shift_id, a.workstation_id)
                counts[key] = counts.get(key, 0) + 1
    return counts


def test_balance_does_not_leave_slots_empty():
    # Bob can only work Friday, so any day Alice works widens the hour gap
    # between them. Hour balancing used to outweigh the slot: Alice was held
    # back and Monday–Thursday stayed empty.
    result = solve(_input(
        [_shift("day")],
        [_ws("w1")],
        [
            _emp("alice"),
            _emp("bob", unavailability=["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]),
        ],
    ))

    assert result.status in ("optimal", "feasible")
    staffed = _staffed(result)
    for date in ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]:
        assert staffed.get((date, "day", "w1"), 0) >= 1, date
    assert result.message is None


def test_long_shift_is_staffed():
    # A 24h on-call costs three times the hours (and far more fatigue) of a
    # day shift; that must not be a reason to leave it uncovered.
    result = solve(_input(
        [_shift("day"), _shift("oncall", start="00:00", end="23:59", weekdays=["2"])],
        [_ws("w1", shifts=("day", "oncall"))],
        [_emp(name, shifts=("day", "oncall")) for name in ("alice", "bob", "carol")],
    ))

    assert _staffed(result).get(("2026-09-09", "oncall", "w1"), 0) == 1


def test_high_priority_workstation_is_staffed_first():
    # One nurse, two workstations wanting her every day: the high-priority one wins.
    result = solve(_input(
        [_shift("day")],
        [_ws("low", priority="low"), _ws("high", priority="high")],
        [_emp("alice")],
        max_working_days_per_week=0,
    ))

    staffed = _staffed(result)
    for day in result.schedule:
        assert staffed.get((str(day.date), "day", "high"), 0) == 1
        assert staffed.get((str(day.date), "day", "low"), 0) == 0


def test_unstaffable_slot_is_reported():
    # Nobody holds the skill the ICU asks for: the slot has no candidate at
    # all, which the solver cannot see as a shortfall — the report must.
    result = solve(_input(
        [_shift("day", weekdays=["0"])],
        [_ws("ward"), _ws("icu", skills=("ventilation",))],
        [_emp("alice")],
    ))

    assert result.status in ("optimal", "feasible")
    assert "Below minimum staffing" in result.message
    assert "ICU 0/1 (nobody qualified and available)" in result.message
    assert "WARD" not in result.message


def test_understaffed_slot_is_reported():
    # Two people, three required per day: filled as far as possible, the rest named.
    result = solve(_input(
        [_shift("day", min_employees=3, weekdays=["0"])],
        [_ws("w1")],
        [_emp("alice"), _emp("bob")],
    ))

    assert _staffed(result)[("2026-09-07", "day", "w1")] == 2
    assert "Day (all workstations) 2/3" in result.message


@pytest.mark.parametrize("mode, statuses", [
    ("soft", ("optimal", "feasible")),
    ("hard", ("infeasible",)),
])
def test_min_staffing_mode(mode, statuses):
    # One person for a minimum of two: soft plans short, hard refuses.
    result = solve(_input(
        [_shift("day", min_employees=2, weekdays=["0"])],
        [_ws("w1")],
        [_emp("alice")],
        min_staffing_mode=mode,
    ))

    assert result.status in statuses
    if mode == "hard":
        assert "'hard'" in result.message


def test_locked_assignment_survives_the_coverage_phase():
    result = solve({
        **_input([_shift("day")], [_ws("w1")], [_emp("alice"), _emp("bob")]),
        "locked_assignments": [
            {"employee_id": "bob", "date": "2026-09-08", "shift_id": "day", "workstation_id": "w1"},
        ],
    })

    bob = next(p for p in result.employee_plans if p.employee_id == "bob")
    tuesday = next(e for e in bob.daily_plan if e.date == "2026-09-08")
    assert tuesday.status == "assigned"
