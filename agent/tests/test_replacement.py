"""Short-notice replacement: who may take one absent person's shift, and in
what order — ranked by the repair's own rules, never an illegal suggestion."""

from datetime import date

import pytest

from shift_agent.agent.repair import RepairError
from shift_agent.agent.replacement import find_replacements

ALL = [str(i) for i in range(7)]
DAY = date(2026, 9, 16)  # a Wednesday


def _shift(sid, start, end, night=False):
    return {
        "id": sid, "name": sid.title(), "is_night_shift": night,
        "weekday_times": [{"weekday": w, "start_time": start, "end_time": end} for w in ALL],
    }


def _emp(eid, **extra):
    return {
        "id": eid, "name": eid.title(), "skills": ["care"],
        "available_shifts": ["early", "late", "night"], "monthly_working_hours": 160, **extra,
    }


def _rules(employees, **constraints):
    return {
        "planning_period": {"start_date": "2026-09-01", "end_date": "2026-09-30"},
        "shifts": [
            _shift("early", "06:00", "14:00"),
            _shift("late", "14:00", "22:00"),
            _shift("night", "22:00", "06:00", night=True),
        ],
        "workstations": [{
            "id": "ward", "name": "Ward", "required_skills": ["care"],
            "operating_shifts": ["early", "late", "night"],
        }],
        "employees": employees,
        "constraints": {"max_working_days_per_week": 0, **constraints},
    }


def _row(eid, day, shift="early", present=True, absence=None):
    return {
        "id": f"{eid}-{day}", "employee_id": eid, "date": day, "shift_id": shift if present else None,
        "workstation_id": "ward" if present else None, "is_present": present, "absence_type": absence,
    }


def _names(answer):
    return [c["employee_id"] for c in answer["candidates"]]


def _reason(answer, eid):
    return next(u["reason"] for u in answer["unavailable"] if u["employee_id"] == eid)


def test_the_slot_is_the_absent_persons_shift():
    answer = find_replacements(
        _rules([_emp("anna"), _emp("ben")]), [_row("anna", "2026-09-16", "late")], "anna", DAY,
    )
    assert answer["slot"]["shift_id"] == "late"
    assert answer["slot"]["workstation_id"] == "ward"
    assert _names(answer) == ["ben"]


def test_no_shift_that_day_is_an_error():
    with pytest.raises(RepairError):
        find_replacements(_rules([_emp("anna")]), [], "anna", DAY)


def test_whoever_is_further_below_their_hours_comes_first():
    roster = [_row("anna", "2026-09-16")]
    # Ben has worked five early shifts this month, Carla one.
    roster += [_row("ben", f"2026-09-0{d}") for d in range(1, 6)]
    roster += [_row("carla", "2026-09-02")]
    answer = find_replacements(_rules([_emp("anna"), _emp("ben"), _emp("carla")]), roster, "anna", DAY)
    assert _names(answer) == ["carla", "ben"]
    assert answer["candidates"][0]["month_hours"] == 8.0


def test_a_wish_for_that_shift_wins():
    dora = _emp("dora", wishes=[{"date": "2026-09-16", "shift_id": "early"}])
    roster = [_row("anna", "2026-09-16")] + [_row("dora", f"2026-09-0{d}") for d in range(1, 6)]
    answer = find_replacements(_rules([_emp("anna"), _emp("ben"), dora]), roster, "anna", DAY)
    assert _names(answer)[0] == "dora"
    assert "wished for this shift" in answer["candidates"][0]["notes"]


def test_a_preferred_day_off_goes_last():
    ben = _emp("ben", preferred_days_off=["2"])  # Wednesdays
    answer = find_replacements(
        _rules([_emp("anna"), ben, _emp("carla")]), [_row("anna", "2026-09-16")], "anna", DAY,
    )
    assert _names(answer) == ["carla", "ben"]


def test_rules_leave_people_out_with_the_reason():
    roster = [
        _row("anna", "2026-09-16"),
        _row("ben", "2026-09-15", "night"),        # still recovering
        _row("carla", "2026-09-15", "late"),       # 8 h rest to a 06:00 start
        _row("dora", "2026-09-16", "late"),        # already working that day
        _row("emil", "2026-09-16", present=False, absence="sick"),
    ]
    fritz = _emp("fritz", skills=[])               # not qualified
    employees = [_emp(e) for e in ("anna", "ben", "carla", "dora", "emil")] + [fritz, _emp("greta")]
    answer = find_replacements(_rules(employees), roster, "anna", DAY)

    assert _names(answer) == ["greta"]
    assert "recovering" in _reason(answer, "ben")
    assert "rest" in _reason(answer, "carla")
    assert "already on Late" in _reason(answer, "dora")
    assert _reason(answer, "emil") == "absent that day"
    assert "lacks" in _reason(answer, "fritz")


def test_personal_limits_are_respected():
    roster = [_row("anna", "2026-09-16", "night"), _row("ben", "2026-09-03", "night")]
    employees = [
        _emp("anna"),
        _emp("ben", max_nights_per_month=1),
        _emp("carla", no_night_shifts=True),
        _emp("dora"),
    ]
    answer = find_replacements(_rules(employees), roster, "anna", DAY)
    assert _names(answer) == ["dora"]
    assert "night shifts this month" in _reason(answer, "ben")
    assert "does not work night shifts" in _reason(answer, "carla")

    soft = find_replacements(_rules(employees, personal_limits_mode="soft"), roster, "anna", DAY)
    assert "ben" in _names(soft), "soft limits do not rule anyone out"


def test_a_streak_across_the_month_edge_counts():
    # Worked 2026-08-28 … 2026-08-31: with a limit of 4, 1 September is out.
    roster = [_row("anna", "2026-09-01")] + [_row("ben", f"2026-08-{d}") for d in (28, 29, 30, 31)]
    answer = find_replacements(
        _rules([_emp("anna"), _emp("ben")], max_consecutive_days=4), roster, "anna", date(2026, 9, 1),
    )
    assert _names(answer) == []
    assert "in a row" in _reason(answer, "ben")


def test_a_planned_day_off_is_free_to_be_asked():
    free = _row("ben", "2026-09-16", present=False, absence="free")
    answer = find_replacements(
        _rules([_emp("anna"), _emp("ben")]), [_row("anna", "2026-09-16"), free], "anna", DAY,
    )
    assert _names(answer) == ["ben"]
    assert answer["candidates"][0]["free_plan_id"] == free["id"], "the row the new shift replaces"


def test_the_slot_says_how_many_are_left_on_it():
    rules = _rules([_emp("anna"), _emp("ben"), _emp("carla")])
    rules["workstations"][0].update(min_employees=1, max_employees=2)
    roster = [_row("anna", "2026-09-16"), _row("ben", "2026-09-16")]
    slot = find_replacements(rules, roster, "anna", DAY)["slot"]
    assert (slot["staffed_without"], slot["min_employees"], slot["max_employees"]) == (1, 1, 2)
