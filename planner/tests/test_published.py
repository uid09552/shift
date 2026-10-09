"""Stability: a re-solve over a published roster moves as few people as it
must. Every employee-day that differs from `published_roster` costs
`change_weight`; coverage still comes first; `changes_vs_published` counts the
differences."""

from shift_planner.optimizer import solve

from test_staffing import _emp, _input, _shift, _ws

# Mon 2026-09-07 … Fri 2026-09-11
DAYS = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]
MON, TUE, WED, THU, FRI = DAYS


def _one_seat():
    """One workstation that takes exactly one person on the day shift."""
    return {**_ws("w1"), "max_employees": 1}


def _published(rows):
    """rows: {(employee_id, date): working?} — working means day shift at w1."""
    return [
        {"employee_id": e, "date": d, "shift_id": "day" if working else None,
         "workstation_id": "w1" if working else None}
        for (e, d), working in rows.items()
    ]


def _plan(result):
    """{(employee_id, date): working?}"""
    return {
        (p.employee_id, str(entry.date)): entry.status == "assigned"
        for p in result.employee_plans
        for entry in p.daily_plan
    }


# Alice Mon/Tue, Bob Wed/Thu, Carol Fri — everyone else off.
ROSTER = {
    (who, day): who == owner
    for day, owner in zip(DAYS, ["alice", "alice", "bob", "bob", "carol"])
    for who in ("alice", "bob", "carol")
}


def _solve(employees, published, **constraints):
    data = _input([_shift("day")], [_one_seat()], employees, max_working_days_per_week=0, **constraints)
    return solve({**data, "published_roster": _published(published)})


def test_the_published_roster_is_kept_when_nothing_forces_a_change():
    result = _solve([_emp("alice"), _emp("bob"), _emp("carol")], ROSTER)

    assert result.status in ("optimal", "feasible")
    assert _plan(result) == ROSTER
    assert result.changes_vs_published == 0


def test_one_sick_day_changes_only_what_coverage_needs():
    employees = [_emp("alice"), _emp("bob", unavailability=[WED]), _emp("carol")]
    result = _solve(employees, ROSTER)

    plan = _plan(result)
    assert plan[("bob", WED)] is False, "Bob is sick"
    covering = [who for who in ("alice", "carol") if plan[(who, WED)]]
    assert len(covering) == 1, "Wednesday is still covered, by one person"
    changed = {key for key, working in plan.items() if ROSTER[key] != working}
    assert changed == {("bob", WED), (covering[0], WED)}, changed
    assert result.changes_vs_published == 2


def test_coverage_beats_stability():
    # The published roster leaves Friday empty; filling it is a change, and made.
    roster = {**ROSTER, ("carol", FRI): False}
    result = _solve([_emp("alice"), _emp("bob"), _emp("carol")], roster)

    plan = _plan(result)
    assert any(plan[(who, FRI)] for who in ("alice", "bob", "carol")), "Friday is filled"
    assert result.changes_vs_published == 1


def test_a_weight_of_zero_ignores_the_published_roster():
    # Alice published all week, the others off: balance spreads the week out
    # once nothing holds it in place.
    lopsided = {(who, day): who == "alice" for day in DAYS for who in ("alice", "bob", "carol")}
    employees = [_emp("alice"), _emp("bob"), _emp("carol")]

    kept = _solve(employees, lopsided)
    assert kept.changes_vs_published == 0, "the default weight keeps it"

    ignored = _solve(employees, lopsided, change_weight=0)
    assert ignored.changes_vs_published > 0
    assert sum(_plan(ignored)[("alice", day)] for day in DAYS) < 5


def test_without_a_published_roster_there_is_no_change_count():
    data = _input([_shift("day")], [_one_seat()], [_emp("alice")])
    assert solve(data).changes_vs_published is None


def test_rows_outside_the_period_or_for_unknown_people_are_ignored():
    roster = {**ROSTER, ("alice", "2026-09-14"): True, ("zoe", MON): True}
    result = _solve([_emp("alice"), _emp("bob"), _emp("carol")], roster)
    assert result.changes_vs_published == 0


def test_a_wish_alone_does_not_move_a_published_shift():
    # Bob wishes Monday's shift, which Alice has been told is hers.
    bob = {**_emp("bob"), "wishes": [{"date": MON, "shift_id": "day"}]}
    result = _solve([_emp("alice"), bob, _emp("carol")], ROSTER)
    assert _plan(result)[("alice", MON)] is True
    assert result.changes_vs_published == 0
