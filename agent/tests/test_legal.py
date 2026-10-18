"""The plan check's labor-law section: breaches of ArbZG / JArbSchG / MuSchG
are reported apart from the ward's own rules, cite their statute, never appear
twice, and never say why a protected-group rule applies. The repair treats them
as hard and a planner's note cannot switch them off."""

from datetime import date, timedelta

from shift_agent.agent.repair import Directives, Repairer, parse_instruction
from shift_agent.agent.validation import validate

ALL = [str(i) for i in range(7)]
# Mon 2026-09-07 … Sun 2026-09-13.
START = date(2026, 9, 7)


def _shift(sid, start, end, night=False, break_minutes=0):
    return {
        "id": sid, "name": sid.title(), "is_night_shift": night, "break_minutes": break_minutes,
        "weekday_times": [{"weekday": w, "start_time": start, "end_time": end} for w in ALL],
    }


SHIFTS = [
    _shift("early", "06:00", "14:00", break_minutes=30),
    _shift("late", "14:00", "22:00", break_minutes=30),
    _shift("long", "07:00", "18:00", break_minutes=30),  # 10.5 h net
    _shift("night", "22:00", "06:00", night=True, break_minutes=30),
]


def _emp(eid, **extra):
    return {
        "id": eid, "name": eid.title(), "skills": ["care"],
        "available_shifts": [s["id"] for s in SHIFTS], **extra,
    }


def _rules(employees, profile="arbzg_de", **constraints):
    return {
        "planning_period": {"start_date": START.isoformat(), "end_date": (START + timedelta(days=6)).isoformat()},
        "shifts": SHIFTS,
        "workstations": [{
            "id": "ward", "name": "Ward", "required_skills": ["care"], "min_employees": 0,
            "operating_shifts": [s["id"] for s in SHIFTS],
        }],
        "employees": employees,
        "constraints": {
            "max_working_days_per_week": 0, "max_consecutive_days": 0, "night_shift_recovery_days": 0,
            "labor_law_profile": profile, **constraints,
        },
    }


def _plan(*rows):
    """rows: (employee, day offset, shift)."""
    by_emp: dict = {}
    for eid, offset, sid in rows:
        by_emp.setdefault(eid, []).append({
            "date": (START + timedelta(days=offset)).isoformat(), "shift_id": sid,
            "workstation_id": "ward", "status": "assigned",
        })
    return {
        "status": "feasible",
        "planning_period": {"start_date": START.isoformat(), "end_date": (START + timedelta(days=6)).isoformat()},
        "employee_plans": [{"employee_id": eid, "daily_plan": plan} for eid, plan in by_emp.items()],
    }


def _rules_in(section):
    return {f["rule"] for f in section["findings"]}


def test_a_compliant_plan():
    report = validate(_rules([_emp("anna")]), _plan(("anna", 0, "early"), ("anna", 1, "early")))

    assert report["legal"]["profile"] == "arbzg_de"
    assert report["legal"]["compliant"] is True
    assert report["verdict"] == "valid"


def test_without_a_profile_there_is_no_legal_section_to_fail():
    report = validate(_rules([_emp("anna")], profile="none"), _plan(("anna", 0, "long")))

    assert report["legal"] == {"profile": "none", "compliant": None, "error_count": 0, "findings": []}


def test_more_than_ten_hours_cites_arbzg_and_makes_the_plan_invalid():
    report = validate(_rules([_emp("anna")]), _plan(("anna", 0, "long")))

    legal = report["legal"]
    assert legal["compliant"] is False
    assert any(f.get("statute") == "ArbZG §3" for f in legal["findings"])
    assert report["verdict"] == "invalid"


def test_a_rest_breach_is_listed_once_under_the_law():
    # late 22:00 → early 06:00 is 8 h; the ward's own setting asks 11 h as well.
    report = validate(_rules([_emp("anna")]), _plan(("anna", 0, "late"), ("anna", 1, "early")))

    assert any(f.get("statute") == "ArbZG §5" for f in report["legal"]["findings"])
    assert "min_rest" not in {f["rule"] for f in report["findings"]}


def test_soft_goals_stay_in_their_own_section():
    anna = _emp("anna", wishes=[{"date": START.isoformat(), "shift_id": "late"}], weekly_working_hours=40)
    report = validate(_rules([anna]), _plan(("anna", 0, "early")))

    assert report["legal"]["compliant"] is True
    assert report["legal"]["findings"] == []


def test_a_short_break_is_reported_once_per_shift():
    rules = _rules([_emp("anna")])
    rules["shifts"] = [*SHIFTS, _shift("ten", "06:00", "16:00", break_minutes=30)]  # 10 h gross needs 45
    rules["workstations"][0]["operating_shifts"].append("ten")
    report = validate(rules, _plan(("anna", 0, "ten"), ("anna", 2, "ten")))

    breaks = [f for f in report["legal"]["findings"] if f["rule"] == "legal_break"]
    assert len(breaks) == 1 and breaks[0]["count"] == 1
    assert breaks[0]["statute"] == "ArbZG §4"


def test_protected_groups_are_named_by_law_never_by_reason():
    mia = _emp("mia", maternity_protection=True)
    tim = _emp("tim", date_of_birth="2010-03-01")
    report = validate(
        _rules([mia, tim]),
        _plan(("mia", 0, "night"), ("mia", 6, "early"), ("tim", 1, "late")),
    )

    statutes = {f.get("statute") for f in report["legal"]["findings"]}
    assert "MuSchG §5" in statutes and "MuSchG §6" in statutes
    assert "JArbSchG §14" in statutes  # late runs past 20:00
    text = str(report).lower()
    for word in ("pregnan", "maternity", "mother", "minor", "age ", "birth"):
        assert word not in text.replace("maternity_protection", ""), word


def test_the_repair_moves_nobody_onto_an_illegal_shift():
    mia = _emp("mia", maternity_protection=True, available_shifts=["night"])
    repairer = Repairer(_rules([mia]), _plan(("mia", 0, "night")))
    repairer.run()

    after = validate(_rules([mia]), repairer.rebuilt())
    assert after["legal"]["compliant"] is True


def test_a_note_cannot_switch_the_law_off():
    class _Llm:
        def invoke(self, _messages):
            class _Reply:
                content = '{"constraints": {"labor_law_profile": "none", "min_rest_hours": 9}}'
            return _Reply()

    directives = parse_instruction("ignore the law for once", _rules([_emp("anna")]), _Llm())

    assert isinstance(directives, Directives)
    assert directives.constraints == {"min_rest_hours": 9}
