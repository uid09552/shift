"""Duty types (on-call, on-site standby), the long-term duty balance and
workstation demand curves (headcount by hour)."""

from shift_planner import legal
from shift_planner.optimizer import solve

from test_legal import ALL_DAYS, _data, _person, _worked
from test_staffing import _emp, _shift, _ws

# Mon 2026-09-07 … Thu 2026-09-10
FOUR_DAYS = {"start_date": "2026-09-07", "end_date": "2026-09-10"}


def _duty(sid, duty_type, start="08:00", end="08:00", weekdays=ALL_DAYS, min_employees=1):
    return {**_shift(sid, start=start, end=end, min_employees=min_employees, weekdays=weekdays), "duty_type": duty_type}


# ---- legal.py ----------------------------------------------------------------


def test_duty_type_rules():
    rules = legal.rules_for("arbzg_de")
    adult = legal.person_rules(rules, {}, None or __import__("datetime").date(2026, 9, 7))
    assert legal.duty_type({"duty_type": "nonsense"}) == "regular"
    assert legal.day_limit(adult, "regular") == (10.0, legal.ARBZG_DAY)
    assert legal.day_limit(adult, "standby") == (24.0, legal.ARBZG_STANDBY)
    minor = legal.person_rules(rules, {"date_of_birth": "2010-01-01"}, __import__("datetime").date(2026, 9, 7))
    assert legal.day_limit(minor, "standby")[0] == 8.0, "a protected group keeps its own limit"
    assert legal.working_hours("on_call", 24.0) == 0.0
    assert legal.working_hours("on_call", 24.0, called_in_minutes=90) == 1.5
    assert legal.working_hours("standby", 23.5) == 23.5
    assert not legal.needs_rest("on_call") and legal.needs_rest("standby")


# ---- On-call and standby -----------------------------------------------------


def test_a_24h_on_call_or_standby_is_legal_where_a_regular_24h_shift_is_not():
    # Standby is working time: 24 h on, then the rest it needs — every other day.
    for duty, planned in (("regular", 0), ("standby", 4), ("on_call", 7)):
        shift = _duty("d24", duty)
        result = solve(_data([shift], [_person("alice", ("d24",))]))
        assert len(_worked(result, "alice")) == planned, (duty, result.message)
        if duty == "regular":
            assert "ArbZG §3" in (result.message or "")


def test_on_call_needs_no_rest_and_owes_no_night_recovery():
    # Night on call 22:00–06:00, then the early shift at 07:00 the next morning.
    on_call = {**_duty("oc", "on_call", start="22:00", end="06:00", weekdays=["0"]), "is_night_shift": True}
    early = _shift("early", start="07:00", end="15:00", weekdays=["1"])
    data = _data([on_call, early], [_person("alice", ("oc", "early"))],
                 min_rest_hours=11, night_shift_recovery_days=2)
    result = solve(data)
    assert len(_worked(result, "alice")) == 2, result.message

    # The same night as regular work leaves the morning empty.
    night = {**on_call, "duty_type": "regular"}
    result = solve(_data([night, early], [_person("alice", ("oc", "early"))],
                         min_rest_hours=11, night_shift_recovery_days=2))
    assert len(_worked(result, "alice")) == 1


def test_on_call_duties_per_month_are_capped():
    on_call = _duty("oc", "on_call", start="18:00", end="23:00")
    result = solve(_data([on_call], [_person("alice", ("oc",), max_on_call_per_month=3)], labor_law_profile="none"))
    assert len(_worked(result, "alice")) == 3

    result = solve(_data([on_call], [_person("alice", ("oc",), max_on_call_per_month=3)],
                         labor_law_profile="none", personal_limits_mode="soft"))
    assert len(_worked(result, "alice")) == 7, "soft: exceeded to cover"
    assert "on-call duties in 2026-09 (max 3)" in result.message


def test_a_call_in_before_the_period_counts_as_work_for_the_weekly_average():
    # One-week reference period: at most 48 h in any 7 days. Five 8-hour days
    # before the period, then a night on call: 40 h. Another 8 h fits on the 7th
    # unless the on-call night had a call-in.
    day = _shift("day", start="08:00", end="16:00", weekdays=ALL_DAYS)
    on_call = _duty("oc", "on_call", start="20:00", end="06:00", min_employees=0)
    worked = [{"employee_id": "alice", "date": f"2026-09-0{d}", "shift_id": "day"} for d in range(1, 6)]
    one_day = {"start_date": "2026-09-07", "end_date": "2026-09-07"}

    def plan(called_in):
        night = {"employee_id": "alice", "date": "2026-09-06", "shift_id": "oc", "called_in_minutes": called_in}
        return solve(_data([day, on_call], [_person("alice", ("day",))], period=one_day,
                           history=worked + [night], labor_law_averaging_weeks=1))

    assert len(_worked(plan(None), "alice")) == 1, "on call without a call-in is rest time"
    assert len(_worked(plan(120), "alice")) == 0, "2 h called in: 50 h > 48 h"


# ---- Long-term fairness -------------------------------------------------------


def _two_people_day_and_night(balance_anna, balance_ben):
    day = _shift("day", start="08:00", end="16:00", weekdays=ALL_DAYS)
    night = {**_shift("night", start="22:00", end="06:00", weekdays=ALL_DAYS), "is_night_shift": True}
    people = [
        {**_emp("anna", shifts=("day", "night")), "weekly_working_hours": 40, "fairness_balance": balance_anna},
        {**_emp("ben", shifts=("day", "night")), "weekly_working_hours": 40, "fairness_balance": balance_ben},
    ]
    ws = {**_ws("w1", shifts=("day", "night")), "max_employees": 1}
    return {
        "planning_period": FOUR_DAYS,
        "shifts": [day, night],
        "workstations": [ws],
        "employees": people,
        "constraints": {
            "solver_time_limit_seconds": 10, "solver_num_workers": 4,
            "min_rest_hours": 0, "night_shift_recovery_days": 0,
            "max_consecutive_days": 0, "max_working_days_per_week": 0,
        },
    }


def test_whoever_did_the_nights_lately_gets_fewer_now():
    result = solve(_two_people_day_and_night({"nights": 12}, {"nights": 0}))
    assert _worked(result, "anna", "night") == []
    assert len(_worked(result, "ben", "night")) == 4

    result = solve(_two_people_day_and_night({"nights": 0}, {"nights": 12}))
    assert _worked(result, "ben", "night") == []


def test_balances_are_per_contract_hour():
    data = _two_people_day_and_night({"nights": 4}, {"nights": 2})
    data["employees"][1]["weekly_working_hours"] = 20  # half time: 2 nights weigh like 4
    data["constraints"]["equality_weight"] = 0
    result = solve(data)
    assert abs(len(_worked(result, "anna", "night")) - 2 * len(_worked(result, "ben", "night"))) <= 2


def test_without_balances_nothing_changes():
    data = _two_people_day_and_night(None, None)
    result = solve(data)
    assert result.status in ("optimal", "feasible")
    assert len(_worked(result, "anna")) == len(_worked(result, "ben")) == 4


# ---- Demand curves --------------------------------------------------------------


def _demand_data(employees, hours, **constraints):
    early = _shift("early", start="06:00", end="14:00", min_employees=0, weekdays=["0"])
    mid = _shift("mid", start="10:00", end="14:00", min_employees=0, weekdays=["0"])
    late = _shift("late", start="14:00", end="22:00", min_employees=0, weekdays=["0"])
    ws = {**_ws("w1", shifts=("early", "mid", "late"), min_employees=5), "demand": [{"weekday": "0", "hours": hours}]}
    return {
        "planning_period": {"start_date": "2026-09-07", "end_date": "2026-09-07"},
        "shifts": [early, mid, late],
        "workstations": [ws],
        "employees": [_emp(e, shifts=("early", "mid", "late")) for e in employees],
        "constraints": {"solver_time_limit_seconds": 10, "solver_num_workers": 4, **constraints},
    }


# 1 person 06–22, 2 between 10 and 14.
CURVE = [0] * 6 + [1] * 4 + [2] * 4 + [1] * 8 + [0] * 2


def test_the_shift_mix_follows_the_curve():
    result = solve(_demand_data(["a", "b", "c", "d"], CURVE))
    shifts = sorted(e.shift_id for p in result.employee_plans for e in p.daily_plan if e.status == "assigned")
    assert shifts == ["early", "late", "mid"], (shifts, result.message)
    assert not result.message, "the curve replaces min_employees (5) and is fully covered"


def test_uncovered_hours_are_named():
    result = solve(_demand_data(["a"], CURVE))
    assert "Demand not covered" in result.message
    assert "W1" in result.message and "/2" in result.message


def test_hard_mode_cannot_leave_an_hour_short():
    result = solve(_demand_data(["a"], CURVE, min_staffing_mode="hard"))
    assert result.status == "infeasible"


def test_an_overnight_shift_covers_the_next_mornings_hours():
    night = {**_shift("night", start="22:00", end="06:00", min_employees=0, weekdays=["6", "0"]), "is_night_shift": True}
    ws = {**_ws("w1", shifts=("night",)), "demand": [{"weekday": "0", "hours": [1] * 6 + [0] * 18}]}
    data = {
        "planning_period": {"start_date": "2026-09-06", "end_date": "2026-09-07"},  # Sun, Mon
        "shifts": [night],
        "workstations": [ws],
        "employees": [_emp("a", shifts=("night",))],
        "constraints": {"solver_time_limit_seconds": 10, "solver_num_workers": 4, "night_shift_recovery_days": 0},
    }
    result = solve(data)
    assert not (result.message or "").count("Demand not covered"), result.message
    assert [str(e.date) for p in result.employee_plans for e in p.daily_plan if e.status == "assigned"][0] == "2026-09-06"
