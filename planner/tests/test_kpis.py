"""Plan-quality KPIs: every solved plan carries coverage, wishes, rule breaks,
fairness spread and the solver's time."""

from shift_planner.optimizer import solve

from test_staffing import _emp, _input, _shift, _ws


def test_a_fully_covered_plan_reports_full_coverage_and_the_solver_time():
    data = _input([_shift("day")], [_ws("w1")], [_emp("alice"), _emp("bob")])
    result = solve(data)

    kpis = result.kpis
    assert kpis is not None
    assert kpis["coverage_pct"] == 100.0
    assert kpis["seats_short"] == 0
    assert kpis["seats_required"] > 0
    assert kpis["soft_rule_breaks"] == 0
    assert kpis["wishes_total"] == 0 and kpis["wishes_met_pct"] is None
    assert kpis["solver_seconds"] >= 0
    assert set(kpis["fairness_spread"]) == {"nights", "weekend_days", "shifts"}


def test_a_short_slot_lowers_coverage():
    # The ward wants two people a day, only one exists.
    ws = {**_ws("w1"), "min_employees": 2}
    data = _input([_shift("day")], [ws], [_emp("alice")], max_working_days_per_week=0)
    result = solve(data)

    assert result.kpis is not None
    assert 0 < result.kpis["seats_short"] <= result.kpis["seats_required"]
    assert result.kpis["coverage_pct"] < 100.0


def test_wishes_met_are_counted():
    first = "2026-09-07"
    emp = {**_emp("alice"), "wishes": [{"date": first, "shift_id": "day"}]}
    data = _input([_shift("day")], [_ws("w1")], [emp, _emp("bob")])
    result = solve(data)

    assert result.kpis["wishes_total"] == 1
    assert result.kpis["wishes_met"] in (0, 1)
    assert result.kpis["wishes_met_pct"] in (0.0, 100.0)
