"""History: the confirmed roster before the period carries its rest rules across
the period start — recovery after a night, rest before the first morning, and a
streak of working days that is already running."""

from shift_planner.optimizer import solve

from test_staffing import _emp, _input, _shift, _ws

# The period is Mon 2026-09-07 … Fri 2026-09-11; history lies before it.
SUN, SAT = "2026-09-06", "2026-09-05"
MON, TUE, WED = "2026-09-07", "2026-09-08", "2026-09-09"
ALL_DAYS = ["0", "1", "2", "3", "4", "5", "6"]


def _history(*rows):
    """rows: (employee_id, date, shift_id)."""
    return [{"employee_id": e, "date": d, "shift_id": s} for e, d, s in rows]


def _night():
    night = _shift("night", start="22:00", end="06:00", min_employees=0, weekdays=ALL_DAYS)
    return {**night, "is_night_shift": True}


def _day(result, employee_id, date):
    plan = next(p for p in result.employee_plans if p.employee_id == employee_id)
    return next(e for e in plan.daily_plan if e.date == date)


def _alone(shifts, history=(), employee=None, **constraints):
    """Alice alone on one workstation running `day`: every day she can work,
    she works, so a day off in the result is one the rules gave her."""
    data = _input(
        shifts,
        [_ws("w1", shifts=[s["id"] for s in shifts])],
        [employee or _emp("alice", shifts=[s["id"] for s in shifts])],
        max_working_days_per_week=0,
        **constraints,
    )
    return solve({**data, "history": list(history)})


def test_a_night_before_the_period_blocks_its_recovery_days():
    shifts = [_shift("day"), _night()]

    without = _alone(shifts)
    assert _day(without, "alice", MON).status == "assigned"

    result = _alone(shifts, _history(("alice", SUN, "night")))
    assert _day(result, "alice", MON).status == "free"
    assert _day(result, "alice", TUE).status == "free"
    assert _day(result, "alice", WED).status == "assigned"


def test_recovery_owed_from_further_back_only_covers_what_is_left():
    # A night on Saturday owes Sunday and Monday; Tuesday is free to work.
    result = _alone([_shift("day"), _night()], _history(("alice", SAT, "night")))
    assert _day(result, "alice", MON).status == "free"
    assert _day(result, "alice", TUE).status == "assigned"


def test_a_late_shift_before_the_period_keeps_the_first_early_shift_free():
    # Late ends 22:00 on Sunday, early starts 06:00 on Monday: 8 h < 11 h.
    late = _shift("late", start="14:00", end="22:00", min_employees=0, weekdays=ALL_DAYS)
    early = _shift("day", start="06:00", end="14:00", weekdays=ALL_DAYS)
    result = _alone([early, late], _history(("alice", SUN, "late")))

    assert _day(result, "alice", MON).shift_id != "day"
    assert _day(result, "alice", TUE).shift_id == "day"


def test_a_running_streak_counts_against_the_consecutive_day_limit():
    # Worked Tuesday to Sunday before the period: six in a row, the limit.
    days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", SUN]
    history = _history(*[("alice", d, "day") for d in days])
    result = _alone([_shift("day", weekdays=ALL_DAYS)], history, max_consecutive_days=6)

    assert _day(result, "alice", MON).status == "free"
    assert _day(result, "alice", TUE).status == "assigned"


def test_a_broken_streak_does_not_count():
    # Four days, then Saturday off: the streak ended before the period.
    days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", SUN]
    history = _history(*[("alice", d, "day") for d in days])
    result = _alone([_shift("day", weekdays=ALL_DAYS)], history, max_consecutive_days=6)

    worked = [e for e in next(p for p in result.employee_plans).daily_plan if e.status == "assigned"]
    assert len(worked) == 5


def test_a_lock_on_a_recovery_day_is_dropped_with_the_reason():
    data = {
        **_input(
            [_shift("day"), _night()],
            [_ws("w1", shifts=("day", "night"))],
            [_emp("alice", shifts=("day", "night")), _emp("bob")],
            max_working_days_per_week=0,
        ),
        "history": _history(("alice", SUN, "night")),
        "locked_assignments": [
            {"employee_id": "alice", "date": MON, "shift_id": "day", "workstation_id": "w1"},
        ],
    }
    result = solve(data)

    assert result.status in ("optimal", "feasible")
    assert "recovery day after Night on 2026-09-06" in result.message
    assert _day(result, "alice", MON).status == "free"


def test_a_fixed_shift_on_a_recovery_day_is_named_not_forced():
    alice = {
        **_emp("alice", shifts=("day", "night")),
        "fixed_shifts": [{"date": MON, "shift_id": "day"}],
    }
    result = _alone([_shift("day"), _night()], _history(("alice", SUN, "night")), employee=alice)

    assert result.status in ("optimal", "feasible")
    assert "Alice 2026-09-07 Day (recovery day after Night on 2026-09-06)" in result.message


def test_history_inside_the_period_and_of_unknown_people_is_ignored():
    shifts = [_shift("day"), _night()]
    history = _history(("alice", MON, "night"), ("nobody", SUN, "night"))
    result = _alone(shifts, history)

    assert _day(result, "alice", MON).status == "assigned"
    assert _day(result, "alice", TUE).status == "assigned"
