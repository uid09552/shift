"""Contract hours are weekly: the solver's target for the period is weekly
hours × days / 7, and 0 means no target."""

from shift_planner.optimizer import solve

from test_staffing import _emp, _shift, _ws

ALL_DAYS = ["0", "1", "2", "3", "4", "5", "6"]
# Mon 2026-09-07 … Sun 2026-09-20: 14 days, one 8-hour shift a day, one post.
TWO_WEEKS = {"start_date": "2026-09-07", "end_date": "2026-09-20"}


def _data(employees):
    shift = _shift("day", weekdays=ALL_DAYS)
    return {
        "planning_period": TWO_WEEKS,
        "shifts": [shift],
        "workstations": [{**_ws("w1"), "max_employees": 1}],
        "employees": employees,
        "constraints": {
            "solver_time_limit_seconds": 10,
            "solver_num_workers": 4,
            # The targets alone decide who works how much.
            "equality_weight": 0,
            "fatigue_weight": 0,
            "shift_continuity_weight": 0,
            "shift_continuity_week_bonus": 0,
            "max_working_days_per_week": 0,
            "max_consecutive_days": 0,
        },
    }


def _hours(result, employee_id):
    plan = next(p for p in result.employee_plans if p.employee_id == employee_id)
    return 8 * sum(1 for e in plan.daily_plan if e.status == "assigned")


def test_weekly_hours_are_prorated_to_the_period():
    # 16 h a week over 14 days is 32 h: four shifts. 40 h a week is 80 h: ten.
    alice = {**_emp("alice"), "weekly_working_hours": 16}
    bob = {**_emp("bob"), "weekly_working_hours": 40}
    result = solve(_data([alice, bob]))

    assert (_hours(result, "alice"), _hours(result, "bob")) == (32, 80)


def test_zero_weekly_hours_is_no_target():
    # Alice has no target, Bob wants 40 h a week (80 h): of the 14 shifts Bob
    # takes ten, and whatever is left goes to Alice — nothing holds her to zero.
    alice = {**_emp("alice"), "weekly_working_hours": 0}
    bob = {**_emp("bob"), "weekly_working_hours": 40}
    result = solve(_data([alice, bob]))

    assert _hours(result, "bob") == 80
    assert _hours(result, "alice") == 32
