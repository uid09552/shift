"""Shift swap check: for each of two people trading confirmed shifts, every
rule the trade would break — warnings for the planner, from the same rules as
the replacement search."""

from datetime import date

import pytest

from shift_agent.agent.repair import RepairError
from shift_agent.agent.replacement import check_exchange

from test_replacement import _emp, _row, _rules

TUE, WED = date(2026, 9, 15), date(2026, 9, 16)


def _violations(answer, eid):
    return next(e["violations"] for e in answer["employees"] if e["employee_id"] == eid)


def test_a_clean_same_day_swap_has_no_warnings():
    roster = [_row("anna", "2026-09-16", "early"), _row("ben", "2026-09-16", "late")]
    answer = check_exchange(_rules([_emp("anna"), _emp("ben")]), roster, "anna", WED, "ben", WED)

    assert [(e["employee_id"], e["takes"]) for e in answer["employees"]] == [
        ("anna", "Late · Ward"), ("ben", "Early · Ward"),
    ]
    assert _violations(answer, "anna") == []
    assert _violations(answer, "ben") == []


def test_too_little_rest_is_a_warning_for_whoever_it_hits():
    # Ben works late on Tuesday; Anna's Wednesday early would leave him 8 h.
    roster = [
        _row("anna", "2026-09-16", "early"),
        _row("ben", "2026-09-15", "late"),
        _row("ben", "2026-09-17", "late"),
    ]
    answer = check_exchange(
        _rules([_emp("anna"), _emp("ben")]), roster, "anna", WED, "ben", date(2026, 9, 17),
    )
    assert any("rest after the previous day's shift" in v for v in _violations(answer, "ben"))
    assert _violations(answer, "anna") == []


def test_every_broken_rule_is_listed_not_just_the_first():
    # Carla gives her Thursday for Anna's Wednesday early: she lacks the
    # ward's qualification *and* works late on Tuesday, 8 h before it.
    roster = [
        _row("anna", "2026-09-16", "early"),
        _row("carla", "2026-09-15", "late"),
        _row("carla", "2026-09-17", "late"),
    ]
    carla = _emp("carla", skills=[])
    answer = check_exchange(
        _rules([_emp("anna"), carla]), roster, "anna", WED, "carla", date(2026, 9, 17),
    )

    warnings = _violations(answer, "carla")
    assert len(warnings) == 2, warnings
    assert "lacks" in warnings[0]
    assert "rest after the previous day's shift" in warnings[1]


def test_the_others_move_is_part_of_the_picture():
    # Anna takes Ben's Tuesday night; her own Wednesday early is gone with the
    # swap, so no recovery warning — but Ben, taking that early, is fine too.
    roster = [_row("anna", "2026-09-16", "early"), _row("ben", "2026-09-15", "night")]
    answer = check_exchange(_rules([_emp("anna"), _emp("ben")]), roster, "anna", WED, "ben", TUE)
    assert _violations(answer, "anna") == []
    assert _violations(answer, "ben") == []


def test_personal_limits_are_warnings():
    roster = [_row("anna", "2026-09-16", "night"), _row("ben", "2026-09-16", "early")]
    answer = check_exchange(
        _rules([_emp("anna"), _emp("ben", no_night_shifts=True)]), roster, "anna", WED, "ben", WED,
    )
    assert "does not work night shifts (personal limit)" in _violations(answer, "ben")


def test_a_missing_shift_is_an_error():
    with pytest.raises(RepairError):
        check_exchange(
            _rules([_emp("anna"), _emp("ben")]), [_row("anna", "2026-09-16")], "anna", WED, "ben", WED,
        )
