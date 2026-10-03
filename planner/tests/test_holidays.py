"""Public holidays: a holiday runs on its shifts' Sunday times and counts as a
weekend day."""

from datetime import date

from shift_planner.optimizer import solve, weekday_num, weekend_key

from test_staffing import PERIOD, WEEKDAYS, _emp, _input, _shift, _ws

HOLIDAY = date(2026, 9, 9)  # a Wednesday


def _worked_days(result, employee_id):
    plan = next(p for p in result.employee_plans if p.employee_id == employee_id)
    return [str(e.date) for e in plan.daily_plan if e.status == "assigned"]


def _run(shift, **extra):
    data = _input([shift], [_ws("w1")], [_emp("alice")])
    data["holidays"] = [HOLIDAY]
    data.update(extra)
    return solve(data)


def test_a_holiday_uses_the_sunday_times_so_a_weekday_only_shift_does_not_run():
    result = _run(_shift("day", weekdays=WEEKDAYS))

    assert str(HOLIDAY) not in _worked_days(result, "alice")
    assert len(_worked_days(result, "alice")) == 4


def test_a_shift_with_sunday_times_runs_on_the_holiday():
    result = _run(_shift("day", weekdays=["6"]))

    assert _worked_days(result, "alice") == [str(HOLIDAY)]


def test_without_the_holiday_the_weekday_applies():
    data = _input([_shift("day", weekdays=["6"])], [_ws("w1")], [_emp("alice")])
    result = solve(data)

    # A Sunday-only shift has no slot on any weekday of the period.
    assert result.status == "infeasible"
    assert not result.employee_plans


def test_weekday_and_weekend_key_follow_the_holiday():
    holidays = {HOLIDAY, date(2026, 9, 11)}  # Wed, Fri
    assert weekday_num(HOLIDAY, holidays) == "6"
    assert weekday_num(date(2026, 9, 10), holidays) == "3"
    assert weekend_key(date(2026, 9, 12)) == date(2026, 9, 12)  # Saturday
    assert weekend_key(date(2026, 9, 13)) == date(2026, 9, 12)  # Sunday
    assert weekend_key(date(2026, 9, 10), holidays) is None
    assert weekend_key(HOLIDAY, holidays) == date(2026, 9, 5)  # Wed: the weekend before
    assert weekend_key(date(2026, 9, 11), holidays) == date(2026, 9, 12)  # Fri: the one after
