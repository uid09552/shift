"""Duty types in the plan check and the repair: on-site standby may run 24 h
under arbzg_de (ArbZG §7) but needs its rest; on call from home is rest time —
no hours, no rest around it, no night recovery. Only call-ins count."""

from datetime import timedelta

from shift_agent.agent.repair import Repairer
from shift_agent.agent.validation import validate

from test_legal import START, SHIFTS, _emp, _plan, _rules, _rules_in

DUTIES = SHIFTS + [
    {**SHIFTS[0], "id": "standby24", "name": "Standby", "duty_type": "standby",
     "weekday_times": [{**wt, "start_time": "08:00", "end_time": "08:00"} for wt in SHIFTS[0]["weekday_times"]]},
    {**SHIFTS[0], "id": "oncall24", "name": "On call", "duty_type": "on_call", "is_night_shift": True,
     "weekday_times": [{**wt, "start_time": "08:00", "end_time": "08:00"} for wt in SHIFTS[0]["weekday_times"]]},
    {**SHIFTS[0], "id": "regular24", "name": "Regular 24", "duty_type": "regular",
     "weekday_times": [{**wt, "start_time": "08:00", "end_time": "08:00"} for wt in SHIFTS[0]["weekday_times"]]},
]


def _duty_rules(**constraints):
    rules = _rules([_emp("anna", available_shifts=[s["id"] for s in DUTIES])], **constraints)
    rules["shifts"] = DUTIES
    rules["workstations"][0]["operating_shifts"] = [s["id"] for s in DUTIES]
    return rules


def test_a_24h_standby_or_on_call_is_not_too_long_a_day_but_regular_24h_is():
    for shift_id, breach in (("standby24", False), ("oncall24", False), ("regular24", True)):
        report = validate(_duty_rules(), _plan(("anna", 0, shift_id)))
        day_rules = {r for r in _rules_in(report["legal"]) if r.startswith("legal_day_hours")}
        assert bool(day_rules) == breach, (shift_id, report["legal"]["findings"])


def test_on_call_needs_no_rest_standby_does():
    report = validate(_duty_rules(min_rest_hours=11), _plan(("anna", 0, "oncall24"), ("anna", 1, "early")))
    assert not any(r.startswith("legal_rest") for r in _rules_in(report["legal"])), report["legal"]["findings"]
    assert "min_rest" not in _rules_in(report)

    report = validate(_duty_rules(min_rest_hours=11), _plan(("anna", 0, "standby24"), ("anna", 1, "early")))
    assert any(r.startswith("legal_rest") for r in _rules_in(report["legal"]))


def test_an_overnight_on_call_owes_no_night_recovery():
    report = validate(_duty_rules(night_shift_recovery_days=2), _plan(("anna", 0, "oncall24"), ("anna", 1, "late")))
    assert "recovery_day_violation" not in _rules_in(report)


def test_a_call_in_counts_towards_the_weekly_average():
    rules = _duty_rules(labor_law_averaging_weeks=1)
    before = START - timedelta(days=1)
    rules["history"] = [
        {"employee_id": "anna", "date": (START - timedelta(days=d)).isoformat(), "shift_id": "early"} for d in range(2, 7)
    ] + [{"employee_id": "anna", "date": before.isoformat(), "shift_id": "oncall24", "called_in_minutes": 300}]
    report = validate(rules, _plan(("anna", 0, "early")))
    # 5 x 7.5 h + 5 h called in + 7.5 h = 50 h in the week ending 7 Sep.
    assert "legal_average" in _rules_in(report["legal"]), report["legal"]["findings"]
    rules["history"][-1]["called_in_minutes"] = 0
    assert "legal_average" not in _rules_in(validate(rules, _plan(("anna", 0, "early")))["legal"])


def test_the_repair_may_place_someone_on_call_right_before_an_early_shift():
    repairer = Repairer(_duty_rules(min_rest_hours=11), _plan(("anna", 1, "early")))
    assert repairer.rules.blocking_reason("anna", START, "oncall24", "ward", repairer.plan) is None
    # A regular evening shift there leaves too little rest before the early one.
    evening = repairer.rules.blocking_reason("anna", START, "late", "ward", repairer.plan)
    assert evening and "rest" in evening
