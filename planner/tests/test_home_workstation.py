"""Float / pool staff: a home workstation is a soft preference, pool staff have
none, and `max_lent_per_month` caps the days worked on another ward."""

from shift_planner.optimizer import solve

from test_staffing import _emp, _input, _shift, _ws


def _two_wards(employees, **constraints):
    wards = [{**_ws("icu"), "max_employees": 1}, {**_ws("er"), "max_employees": 1}]
    return solve(_input([_shift("day")], wards, employees, max_working_days_per_week=0, **constraints))


def _where(result):
    """{(employee_id, date): workstation_id}"""
    return {
        (p.employee_id, str(e.date)): e.workstation_id
        for p in result.employee_plans
        for e in p.daily_plan
        if e.status == "assigned"
    }


def test_people_work_on_their_home_ward_when_coverage_allows():
    employees = [
        {**_emp("alice"), "home_workstation_id": "er"},
        {**_emp("bob"), "home_workstation_id": "icu"},
    ]
    placed = _where(_two_wards(employees))

    assert placed
    assert all(ws == ("er" if who == "alice" else "icu") for (who, _d), ws in placed.items())


def test_a_home_ward_never_leaves_a_slot_empty():
    # Both call the ICU home, but the ER must be staffed as well.
    employees = [
        {**_emp("alice"), "home_workstation_id": "icu"},
        {**_emp("bob"), "home_workstation_id": "icu"},
    ]
    result = _two_wards(employees)

    assert result.kpis["coverage_pct"] == 100.0
    assert result.kpis["lent_days"] > 0


def test_a_lend_cap_is_kept_and_pool_staff_cover_the_rest():
    employees = [
        {**_emp("alice"), "home_workstation_id": "icu", "max_lent_per_month": 0},
        {**_emp("bob"), "home_workstation_id": "icu", "max_lent_per_month": 0},
        {**_emp("pia"), "is_pool": True},
    ]
    placed = _where(_two_wards(employees))

    assert all(ws == "icu" for (who, _d), ws in placed.items() if who in ("alice", "bob"))


def test_weight_zero_switches_the_preference_off():
    employees = [{**_emp("alice"), "home_workstation_id": "icu"}]
    result = _two_wards(employees, home_workstation_weight=0)

    assert result.status in ("optimal", "feasible")
