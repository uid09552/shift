"""Skill-mix and pairing rules in the agent: the plan check reports breaches
(hard ones as errors, soft ones as warnings), the repair moves people out of a
hard breach, and a replacement is not offered someone a hard rule keeps out."""

from shift_agent.agent.repair import Repairer
from shift_agent.agent.replacement import find_replacements
from shift_agent.agent.validation import validate

from test_replacement import DAY, _emp, _row, _rules

CATALOG = [
    {"id": "care", "level": 1, "skill_group": "nursing"},
    {"id": "senior", "level": 3, "skill_group": "nursing"},
    {"id": "trainee", "level": 1, "skill_group": None},
]


def _with_rules(employees, mix=(), pairs=(), **constraints):
    rules = _rules(employees, **constraints)
    rules["capabilities"] = CATALOG
    rules["skill_mix_rules"] = list(mix)
    rules["pairing_rules"] = list(pairs)
    return rules


def _result(cells):
    """{employee_id: [(day, shift)]} → an optimizer result on the ward."""
    return {
        "planning_period": {"start_date": "2026-09-01", "end_date": "2026-09-30"},
        "employee_plans": [
            {
                "employee_id": employee_id,
                "daily_plan": [
                    {"date": day, "status": "assigned", "shift_id": shift, "workstation_id": "ward"}
                    for day, shift in days
                ],
            }
            for employee_id, days in cells.items()
        ],
    }


def _finding(report, rule):
    return next((f for f in report["findings"] if f["rule"] == rule), None)


SENIOR = {"id": "senior", "kind": "at_least", "count": 1, "skill_group": "nursing", "min_level": 3}
APART = {"id": "apart", "kind": "apart", "employee_id": "anna", "partner_id": "ben"}


def test_a_hard_skill_mix_breach_is_an_error_and_a_soft_one_a_warning():
    people = [_emp("anna"), _emp("ben")]
    plan = _result({"anna": [("2026-09-16", "early")], "ben": [("2026-09-16", "early")]})

    hard = validate(_with_rules(people, mix=[SENIOR]), plan)
    finding = _finding(hard, "skill_mix")
    assert finding and finding["severity"] == "error", hard["findings"]
    assert "2026-09-16 Early" in finding["examples"][0]
    assert hard["verdict"] == "invalid"

    soft = validate(_with_rules(people, mix=[{**SENIOR, "mode": "soft"}]), plan)
    assert _finding(soft, "skill_mix") is None
    assert _finding(soft, "skill_mix_soft")["severity"] == "warning"


def test_a_senior_on_the_shift_meets_the_rule():
    people = [_emp("anna"), _emp("ben", skills=["senior"])]
    plan = _result({"anna": [("2026-09-16", "early")], "ben": [("2026-09-16", "early")]})
    report = validate(_with_rules(people, mix=[SENIOR]), plan)
    assert _finding(report, "skill_mix") is None


def test_pairing_breaches_are_named_with_both_people():
    people = [_emp("anna"), _emp("ben")]
    plan = _result({"anna": [("2026-09-16", "early")], "ben": [("2026-09-16", "early")]})
    report = validate(_with_rules(people, pairs=[APART]), plan)
    finding = _finding(report, "pairing")
    assert finding and finding["severity"] == "error"
    assert "Anna and Ben are on the same shift" in finding["examples"][0]


def test_no_rules_no_findings():
    people = [_emp("anna"), _emp("ben")]
    plan = _result({"anna": [("2026-09-16", "early")], "ben": [("2026-09-16", "early")]})
    report = validate(_with_rules(people), plan)
    assert not [f for f in report["findings"] if f["rule"].startswith(("skill_mix", "pairing"))]


def test_the_repair_moves_two_who_must_be_apart():
    people = [_emp("anna"), _emp("ben")]
    rules = _with_rules(people, pairs=[APART])
    plan = _result({"anna": [("2026-09-16", "early")], "ben": [("2026-09-16", "early")]})

    repairer = Repairer(rules, plan)
    repairer.run()
    after = validate(rules, repairer.rebuilt())

    assert _finding(after, "pairing") is None, after["findings"]


def test_a_replacement_is_not_offered_to_someone_a_hard_rule_keeps_out():
    # Anna is off sick; Carla is on the early shift already and may not work
    # beside Ben, so Ben cannot take Anna's early shift. Dora can.
    people = [_emp("anna"), _emp("ben"), _emp("carla"), _emp("dora")]
    rules = _with_rules(people, pairs=[{"id": "x", "kind": "apart", "employee_id": "ben", "partner_id": "carla"}])
    day = DAY.isoformat()
    answer = find_replacements(rules, [_row("anna", day), _row("carla", day)], "anna", DAY)

    candidates = [c["employee_id"] for c in answer["candidates"]]
    assert "dora" in candidates and "ben" not in candidates
    reason = next(u["reason"] for u in answer["unavailable"] if u["employee_id"] == "ben")
    assert reason == "may not work the same shift as Carla"


def test_a_trainee_is_not_offered_a_shift_their_mentor_is_not_on():
    people = [_emp("anna"), _emp("tim", skills=["care", "trainee"]), _emp("mia")]
    rules = _with_rules(people, pairs=[{"id": "m", "kind": "mentor", "employee_id": "tim", "partner_id": "mia"}])
    day = DAY.isoformat()
    answer = find_replacements(rules, [_row("anna", day)], "anna", DAY)
    reason = next(u["reason"] for u in answer["unavailable"] if u["employee_id"] == "tim")
    assert reason == "their mentor Mia is not on that shift"
