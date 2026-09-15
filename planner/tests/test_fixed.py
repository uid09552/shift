"""Fixed assignments (what rotation patterns write): kept ahead of every other
goal, named when they cannot be kept, never the reason a plan fails."""

from shift_planner.optimizer import solve

from test_staffing import _emp, _input, _shift, _ws

MON, TUE, WED = "2026-09-07", "2026-09-08", "2026-09-09"


def _fixed(emp, *entries):
    """entries: (date, shift_id or None for a day off)."""
    return {**emp, "fixed_shifts": [{"date": d, "shift_id": s} for d, s in entries]}


def _day(result, employee_id, date):
    plan = next(p for p in result.employee_plans if p.employee_id == employee_id)
    return next(e for e in plan.daily_plan if e.date == date)


def test_a_fixed_shift_is_worked():
    # Alice is fixed on the late shift on Tuesday; nothing else would put her there.
    result = solve(_input(
        [_shift("early"), _shift("late", start="14:00", end="22:00", min_employees=0)],
        [_ws("w1", shifts=("early", "late"))],
        [_fixed(_emp("alice", shifts=("early", "late")), (TUE, "late")), _emp("bob")],
    ))

    assert _day(result, "alice", TUE).shift_id == "late"
    assert "not kept" not in (result.message or "")


def test_a_fixed_day_off_beats_minimum_staffing():
    # Alice is the only one who could cover Wednesday, and she is fixed off:
    # the day goes short and the plan says so, rather than moving her.
    result = solve(_input(
        [_shift("day")],
        [_ws("w1")],
        [_fixed(_emp("alice"), (WED, None))],
        max_working_days_per_week=0,
    ))

    assert _day(result, "alice", WED).status == "free"
    assert _day(result, "alice", MON).status == "assigned"
    assert "Below minimum staffing" in result.message
    assert "not kept" not in result.message


def test_a_fixed_shift_on_an_absence_is_named_not_forced():
    result = solve(_input(
        [_shift("day")],
        [_ws("w1")],
        [_fixed(_emp("alice", unavailability=[MON]), (MON, "day")), _emp("bob")],
    ))

    assert result.status in ("optimal", "feasible")
    assert "Fixed assignment(s) not kept: Alice 2026-09-07 Day (absent that day)" in result.message


def test_a_rotation_that_breaks_the_day_cap_still_plans():
    # Fixed on all five days with a cap of four: a hard rule would make the
    # plan infeasible. Four are kept, one is named.
    result = solve(_input(
        [_shift("day")],
        [_ws("w1")],
        [_fixed(_emp("alice"), *[(d, "day") for d in (MON, TUE, WED, "2026-09-10", "2026-09-11")])],
        max_working_days_per_week=4,
    ))

    assert result.status in ("optimal", "feasible")
    worked = [e for e in next(p for p in result.employee_plans if p.employee_id == "alice").daily_plan if e.status == "assigned"]
    assert len(worked) == 4
    assert "Fixed assignment(s) not kept" in result.message
    assert "clashes with rest rules or day limits" in result.message


def test_fixed_assignments_can_be_switched_off():
    # Fixed off on Wednesday, but the tenant has rotations switched off: the
    # only person who can cover Wednesday works it.
    result = solve(_input(
        [_shift("day")],
        [_ws("w1")],
        [_fixed(_emp("alice"), (WED, None))],
        max_working_days_per_week=0,
        keep_fixed_assignments=False,
    ))

    assert _day(result, "alice", WED).status == "assigned"
    assert "not kept" not in (result.message or "")
    assert "Below minimum staffing" not in (result.message or "")
