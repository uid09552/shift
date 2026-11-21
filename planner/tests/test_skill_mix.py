"""Skill-mix and pairing rules: the solver keeps hard ones, breaks soft ones
only where staffing needs it and names every breach (see skill_mix.py)."""

from pathlib import Path

from shift_planner import skill_mix
from shift_planner.optimizer import solve

# Mon 2026-09-07 … Fri 2026-09-11
PERIOD = {"start_date": "2026-09-07", "end_date": "2026-09-11"}
DAYS = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]
WEEKDAYS = ["0", "1", "2", "3", "4"]

CATALOG = [
    {"id": "nurse_1", "level": 1, "skill_group": "nursing"},
    {"id": "nurse_3", "level": 3, "skill_group": "nursing"},
    {"id": "trainee", "level": 1, "skill_group": None},
]


def _shift(sid, start="08:00", end="16:00", min_employees=0):
    return {
        "id": sid,
        "name": sid.title(),
        "is_night_shift": False,
        "weekday_times": [
            {"weekday": wd, "start_time": start, "end_time": end, "min_employees": min_employees}
            for wd in WEEKDAYS
        ],
    }


def _ws(wid="icu", shifts=("day",), min_employees=2, max_employees=None, skills=("nurse_1",)):
    return {
        "id": wid,
        "name": wid.upper(),
        "required_skills": list(skills),
        "priority": "high",
        "operating_shifts": list(shifts),
        "min_employees": min_employees,
        "max_employees": max_employees,
    }


def _emp(eid, skills=("nurse_1",), shifts=("day",), unavailability=()):
    return {
        "id": eid,
        "name": eid.title(),
        "skills": list(skills),
        "available_shifts": list(shifts),
        "unavailability": list(unavailability),
    }


def _input(shifts, workstations, employees, mix=(), pairs=(), **constraints):
    return {
        "planning_period": PERIOD,
        "shifts": shifts,
        "workstations": workstations,
        "employees": employees,
        "capabilities": CATALOG,
        "skill_mix_rules": list(mix),
        "pairing_rules": list(pairs),
        "constraints": {"solver_time_limit_seconds": 10, "solver_num_workers": 4, **constraints},
    }


def _cells(result):
    """{(employee_id, date): (shift_id, workstation_id)}"""
    cells = {}
    for plan in result.employee_plans:
        for entry in plan.daily_plan:
            if entry.status == "assigned":
                cells[(plan.employee_id, str(entry.date))] = (entry.shift_id, entry.workstation_id)
    return cells


def _on(result, day, shift="day"):
    return sorted(e for (e, d), (s, _w) in _cells(result).items() if d == day and s == shift)


SENIOR_PER_SHIFT = {"id": "senior", "kind": "at_least", "count": 1, "skill_group": "nursing", "min_level": 3}


def test_without_a_rule_the_senior_is_spared_for_lower_work():
    # The baseline the rule is measured against: covering a level-1 slot with a
    # level-3 nurse costs a downgrade penalty, so the solver avoids it.
    people = [_emp("j1"), _emp("j2"), _emp("j3"), _emp("s1", skills=("nurse_3",))]
    result = solve(_input([_shift("day")], [_ws()], people))
    assert result.status in ("optimal", "feasible")
    assert any("s1" not in _on(result, day) for day in DAYS)


def test_at_least_puts_a_senior_on_every_staffed_shift():
    people = [_emp("j1"), _emp("j2"), _emp("j3"), _emp("s1", skills=("nurse_3",)), _emp("s2", skills=("nurse_3",))]
    result = solve(_input([_shift("day")], [_ws()], people, mix=[SENIOR_PER_SHIFT]))
    assert result.status in ("optimal", "feasible"), result.message
    for day in DAYS:
        on = _on(result, day)
        assert on, f"{day} is staffed"
        assert {"s1", "s2"} & set(on), f"a senior on {day}: {on}"
    assert not result.message or "Skill-mix" not in result.message


def test_a_hard_minimum_that_cannot_hold_leaves_the_slot_empty_rather_than_breaking_it():
    # The only senior is away on Tuesday: the slot may not run without one.
    people = [_emp("j1"), _emp("j2"), _emp("s1", skills=("nurse_3",), unavailability=["2026-09-08"])]
    result = solve(_input([_shift("day")], [_ws()], people, mix=[SENIOR_PER_SHIFT], max_working_days_per_week=7))
    assert result.status in ("optimal", "feasible"), result.message
    assert _on(result, "2026-09-08") == [], "no senior, so nobody"
    assert "Below minimum staffing" in (result.message or "")


def test_a_soft_minimum_gives_way_to_coverage_and_is_named():
    people = [_emp("j1"), _emp("j2"), _emp("s1", skills=("nurse_3",), unavailability=["2026-09-08"])]
    soft = {**SENIOR_PER_SHIFT, "mode": "soft"}
    result = solve(_input([_shift("day")], [_ws()], people, mix=[soft], max_working_days_per_week=7))
    assert result.status in ("optimal", "feasible"), result.message
    assert _on(result, "2026-09-08") == ["j1", "j2"], "staffed without a senior"
    assert "Skill-mix or pairing rule(s) not met" in result.message
    assert "2026-09-08" in result.message
    # On the other days the senior is still there: soft is not off.
    for day in DAYS:
        if day != "2026-09-08":
            assert "s1" in _on(result, day), day


def test_at_most_caps_the_trainees_on_a_shift():
    people = [_emp(f"t{i}", skills=("nurse_1", "trainee")) for i in range(3)] + [_emp(f"n{i}") for i in range(3)]
    rule = {"id": "trainees", "kind": "at_most", "count": 1, "capability": "trainee"}
    result = solve(_input([_shift("day")], [_ws(min_employees=3)], people, mix=[rule], max_working_days_per_week=7))
    assert result.status in ("optimal", "feasible"), result.message
    for day in DAYS:
        on = _on(result, day)
        assert len(on) >= 3, f"{day}: {on}"
        assert sum(1 for e in on if e.startswith("t")) <= 1, f"{day}: {on}"


def test_a_rule_for_one_workstation_leaves_the_others_alone():
    people = [_emp(f"t{i}", skills=("nurse_1", "trainee")) for i in range(4)]
    rule = {"id": "trainees", "kind": "at_most", "count": 0, "capability": "trainee", "workstation_id": "icu"}
    result = solve(_input(
        [_shift("day")], [_ws("icu", min_employees=1), _ws("ward", min_employees=1)], people,
        mix=[rule], max_working_days_per_week=7,
    ))
    cells = _cells(result)
    assert all(w != "icu" for (_e, _d), (_s, w) in cells.items()), "no trainee at ICU"
    assert any(w == "ward" for (_e, _d), (_s, w) in cells.items()), "the ward is still staffed"


def test_a_trainee_works_only_beside_their_mentor():
    people = [
        _emp("trainee", skills=("nurse_1", "trainee")),
        _emp("mentor", unavailability=["2026-09-09"]),
        _emp("n1"),
        _emp("n2"),
    ]
    pair = {"id": "m", "kind": "mentor", "employee_id": "trainee", "partner_id": "mentor"}
    result = solve(_input([_shift("day")], [_ws("icu"), _ws("ward")], people, pairs=[pair], max_working_days_per_week=7))
    cells = _cells(result)
    for day in DAYS:
        mine = cells.get(("trainee", day))
        if mine is not None:
            assert cells.get(("mentor", day)) == mine, f"{day}: trainee at {mine}, mentor at {cells.get(('mentor', day))}"
    assert ("trainee", "2026-09-09") not in cells, "no mentor that day"


def test_two_who_must_be_apart_never_share_a_shift():
    people = [_emp("a", shifts=("early", "late")), _emp("b", shifts=("early", "late")), _emp("c", shifts=("early", "late"))]
    shifts = [_shift("early", "06:00", "14:00", 1), _shift("late", "14:00", "22:00", 1)]
    ws = _ws(shifts=("early", "late"), min_employees=1)
    pair = {"id": "p", "kind": "apart", "employee_id": "a", "partner_id": "b"}
    result = solve(_input(shifts, [ws], people, pairs=[pair], max_working_days_per_week=7, min_rest_hours=0))
    cells = _cells(result)
    for day in DAYS:
        a, b = cells.get(("a", day)), cells.get(("b", day))
        if a and b:
            assert a[0] != b[0], day


def test_two_who_work_together_share_the_shift_when_both_work():
    people = [_emp(e, shifts=("early", "late")) for e in ("a", "b", "c", "d")]
    shifts = [_shift("early", "06:00", "14:00", 2), _shift("late", "14:00", "22:00", 2)]
    ws = _ws(shifts=("early", "late"), min_employees=2)
    pair = {"id": "p", "kind": "together", "employee_id": "a", "partner_id": "b"}
    result = solve(_input(shifts, [ws], people, pairs=[pair], max_working_days_per_week=7, min_rest_hours=0))
    assert result.status in ("optimal", "feasible"), result.message
    cells = _cells(result)
    both = [day for day in DAYS if ("a", day) in cells and ("b", day) in cells]
    assert both, "they work together at least once"
    for day in both:
        assert cells[("a", day)][0] == cells[("b", day)][0], day


# --- the checker (shared with the agent) -------------------------------------


def test_check_names_every_kind_of_breach():
    mix, pairs = skill_mix.parse({
        "skill_mix_rules": [SENIOR_PER_SHIFT, {"id": "t", "kind": "at_most", "count": 0, "capability": "trainee"}],
        "pairing_rules": [
            {"id": "m", "kind": "mentor", "employee_id": "t1", "partner_id": "s1"},
            {"id": "x", "kind": "apart", "employee_id": "j1", "partner_id": "t1"},
        ],
    })
    rows = [("j1", "2026-09-07", "day", "icu"), ("t1", "2026-09-07", "day", "icu")]
    skills = {"j1": {"nurse_1"}, "t1": {"nurse_1", "trainee"}, "s1": {"nurse_3"}}
    breaches = skill_mix.check(mix, pairs, rows, skills, skill_mix.catalog_of({"capabilities": CATALOG}))
    assert sorted(b.rule_id for b in breaches) == ["m", "senior", "t", "x"]
    assert all(b.hard for b in breaches)


def test_a_higher_level_of_the_group_counts_toward_a_named_capability():
    catalog = skill_mix.catalog_of({"capabilities": CATALOG})
    rule = skill_mix.parse({"skill_mix_rules": [{"id": "r", "kind": "at_least", "count": 1, "capability": "nurse_1"}]})[0][0]
    assert skill_mix.counts_toward(rule, {"nurse_3"}, catalog)
    assert not skill_mix.counts_toward(rule, {"trainee"}, catalog)


def test_malformed_rules_are_left_out():
    mix, pairs = skill_mix.parse({
        "skill_mix_rules": [
            {"kind": "at_least", "count": 1},                      # nothing to count
            {"kind": "at_most", "count": 1, "skill_group": "x", "min_level": 1},  # at_most needs a capability
            {"kind": "sometimes", "count": 1, "capability": "x"},
            {"kind": "at_least", "count": "many", "capability": "x"},
        ],
        "pairing_rules": [{"kind": "apart", "employee_id": "a", "partner_id": "a"}, {"kind": "mentor"}],
    })
    assert mix == [] and pairs == []


def test_placement_reasons_cover_what_one_move_can_break():
    mix, pairs = skill_mix.parse({
        "skill_mix_rules": [{"id": "t", "kind": "at_most", "count": 1, "capability": "trainee"}],
        "pairing_rules": [
            {"id": "m", "kind": "mentor", "employee_id": "t2", "partner_id": "s1"},
            {"id": "a", "kind": "apart", "employee_id": "j1", "partner_id": "j2"},
        ],
    })
    cells = {("t1", "d"): ("day", "icu"), ("j2", "d"): ("day", "icu")}
    skills = {"t1": {"trainee"}, "t2": {"trainee"}}
    reasons = skill_mix.placement_reasons(
        mix, pairs, "t2", "d", "day", "icu",
        lambda e, d: cells.get((e, d)),
        lambda d, s, w: [e for (e, dd), (ss, ww) in cells.items() if dd == d and ss == s and (w is None or ww == w)],
        skills, {},
    )
    assert any("more than 1 × trainee" in r for r in reasons)
    assert any("mentor" in r for r in reasons)
    apart = skill_mix.placement_reasons(
        mix, pairs, "j1", "d", "day", "icu", lambda e, d: cells.get((e, d)), lambda d, s, w: [], {}, {},
    )
    assert apart == ["may not work the same shift as j2"]


def test_the_agent_carries_an_identical_copy():
    here = Path(__file__).resolve().parents[1] / "shift_planner" / "skill_mix.py"
    copy = Path(__file__).resolve().parents[2] / "agent" / "shift_agent" / "agent" / "skill_mix.py"
    assert copy.read_text() == here.read_text(), "agent/shift_agent/agent/skill_mix.py differs from planner/shift_planner/skill_mix.py"
