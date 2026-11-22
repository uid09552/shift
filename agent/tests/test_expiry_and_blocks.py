"""The plan check and repair know when a qualification has expired and which
shifts a recurring availability rule takes out — as the solver does."""

from shift_agent.agent.replacement import find_replacements
from shift_agent.agent.validation import validate

from test_replacement import DAY, _emp, _row, _rules


def _with_ward_skill(employees, skill="resus"):
    rules = _rules(employees)
    rules["workstations"][0]["required_skills"] = [skill]
    return rules


def _result(cells):
    return {
        "planning_period": {"start_date": "2026-09-01", "end_date": "2026-09-30"},
        "employee_plans": [
            {
                "employee_id": employee_id,
                "daily_plan": [
                    {"date": day, "status": "assigned", "shift_id": "early", "workstation_id": "ward"} for day in days
                ],
            }
            for employee_id, days in cells.items()
        ],
    }


def _finding(report, rule):
    return next((f for f in report["findings"] if f["rule"] == rule), None)


def test_an_expired_qualification_is_an_error_of_its_own():
    anna = _emp("anna", skills=["resus"], skill_expiry={"resus": "2026-09-10"})
    report = validate(_with_ward_skill([anna]), _result({"anna": ["2026-09-10", "2026-09-11"]}))
    expired = _finding(report, "capability_expired")
    assert expired and expired["severity"] == "error", report["findings"]
    assert expired["count"] == 1, "the 10th is the last valid day"
    assert "2026-09-11" in expired["examples"][0]
    assert _finding(report, "missing_skills") is None, "not missing — expired"


def test_a_blocked_shift_is_an_error():
    anna = _emp("anna", blocked_shifts=[{"date": "2026-09-16", "shift_id": "early"}])
    report = validate(_rules([anna]), _result({"anna": ["2026-09-16"]}))
    assert _finding(report, "shift_blocked")["severity"] == "error"


def test_a_replacement_is_not_offered_to_someone_whose_certificate_has_lapsed_or_who_is_blocked():
    people = [
        _emp("anna", skills=["resus"]),
        _emp("ben", skills=["resus"], skill_expiry={"resus": "2026-09-01"}),
        _emp("carla", skills=["resus"], blocked_shifts=[{"date": DAY.isoformat(), "shift_id": "early"}]),
        _emp("dora", skills=["resus"]),
    ]
    answer = find_replacements(_with_ward_skill(people), [_row("anna", DAY.isoformat())], "anna", DAY)
    reasons = {u["employee_id"]: u["reason"] for u in answer["unavailable"]}
    assert [c["employee_id"] for c in answer["candidates"]] == ["dora"]
    assert reasons["ben"] == "resus expired before that day"
    assert reasons["carla"] == "does not work the Early that day"
