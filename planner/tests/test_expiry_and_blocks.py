"""A capability that lapses stops counting after its last valid day, and a
shift a recurring availability rule takes out is never assigned."""

from shift_planner.optimizer import solve

# Mon 2026-09-07 … Fri 2026-09-11
PERIOD = {"start_date": "2026-09-07", "end_date": "2026-09-11"}
DAYS = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]


def _shift(sid="day"):
    return {
        "id": sid, "name": sid.title(), "is_night_shift": False,
        "weekday_times": [{"weekday": wd, "start_time": "08:00", "end_time": "16:00", "min_employees": 0} for wd in "01234"],
    }


def _ws(skills=("resus",)):
    return {
        "id": "icu", "name": "ICU", "required_skills": list(skills), "priority": "high",
        "operating_shifts": ["day"], "min_employees": 1,
    }


def _emp(eid, skills=("resus",), **extra):
    return {"id": eid, "name": eid.title(), "skills": list(skills), "available_shifts": ["day"], **extra}


def _input(employees):
    return {
        "planning_period": PERIOD, "shifts": [_shift()], "workstations": [_ws()], "employees": employees,
        "constraints": {"solver_time_limit_seconds": 10, "solver_num_workers": 4, "max_working_days_per_week": 7},
    }


def _days_of(result, employee_id):
    return sorted(
        str(entry.date)
        for plan in result.employee_plans if plan.employee_id == employee_id
        for entry in plan.daily_plan if entry.status == "assigned"
    )


def test_a_lapsed_capability_stops_counting_after_its_last_day():
    # Anna's certificate is valid through Tuesday; only she holds one.
    result = solve(_input([_emp("anna", skill_expiry={"resus": "2026-09-08"})]))
    assert result.status in ("optimal", "feasible"), result.message
    assert _days_of(result, "anna") == ["2026-09-07", "2026-09-08"]
    assert "Below minimum staffing" in (result.message or ""), "Wednesday on has nobody qualified"


def test_a_colleague_with_a_valid_certificate_takes_over():
    result = solve(_input([
        _emp("anna", skill_expiry={"resus": "2026-09-08"}),
        _emp("ben"),
    ]))
    for day in DAYS[2:]:
        assert day not in _days_of(result, "anna"), day
        assert day in _days_of(result, "ben"), day


def test_an_expiry_after_the_period_changes_nothing():
    result = solve(_input([_emp("anna", skill_expiry={"resus": "2026-12-31"})]))
    assert _days_of(result, "anna") == DAYS


def test_a_blocked_shift_is_never_assigned():
    result = solve(_input([
        _emp("anna", blocked_shifts=[{"date": "2026-09-09", "shift_id": "day"}]),
    ]))
    assert "2026-09-09" not in _days_of(result, "anna")
    assert set(_days_of(result, "anna")) == set(DAYS) - {"2026-09-09"}
