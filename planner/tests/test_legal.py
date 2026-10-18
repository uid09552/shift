"""Labor-law profile (legal.py): ArbZG for everyone, JArbSchG for minors,
MuSchG for maternity protection — hard rules the solver never breaks, and
slots they leave empty are named in `message`."""

from datetime import date
from pathlib import Path

from shift_planner import legal
from shift_planner.optimizer import solve

from test_staffing import _emp, _shift, _ws

ALL_DAYS = ["0", "1", "2", "3", "4", "5", "6"]
# Mon 2026-09-07 … Sun 2026-09-13.
WEEK = {"start_date": "2026-09-07", "end_date": "2026-09-13"}


def _data(shifts, employees, period=WEEK, history=(), **constraints):
    return {
        "planning_period": period,
        "shifts": shifts,
        "workstations": [{**_ws("w1", shifts=[s["id"] for s in shifts]), "max_employees": 1}],
        "employees": employees,
        "history": list(history),
        "constraints": {
            "solver_time_limit_seconds": 10,
            "solver_num_workers": 4,
            # Only the rule under test may keep anyone off.
            "max_working_days_per_week": 0,
            "max_consecutive_days": 0,
            "night_shift_recovery_days": 0,
            "min_rest_hours": 0,
            "labor_law_profile": "arbzg_de",
            **constraints,
        },
    }


def _worked(result, employee_id, shift_id=None):
    plan = next(p for p in result.employee_plans if p.employee_id == employee_id)
    return [
        date.fromisoformat(str(e.date)) for e in plan.daily_plan
        if e.status == "assigned" and (shift_id is None or e.shift_id == shift_id)
    ]


def _person(eid, shifts, **extra):
    return {**_emp(eid, shifts=shifts), **extra}


# ---- ArbZG -----------------------------------------------------------------


def test_without_a_profile_a_long_shift_is_planned():
    long = _shift("long", start="07:00", end="18:00", weekdays=ALL_DAYS)  # 11 h
    result = solve(_data([long], [_person("alice", ("long",))], labor_law_profile="none"))

    assert len(_worked(result, "alice")) == 7


def test_more_than_ten_hours_a_day_is_never_planned_and_the_slot_is_named():
    long = _shift("long", start="07:00", end="18:00", weekdays=ALL_DAYS)  # 11 h, no break
    result = solve(_data([long], [_person("alice", ("long",))]))

    assert _worked(result, "alice") == []
    assert "labor law" in result.message
    assert "ArbZG §3" in result.message


def test_hours_count_net_of_the_break():
    long = {**_shift("long", start="07:00", end="18:00", weekdays=ALL_DAYS), "break_minutes": 60}  # 10 h net
    result = solve(_data([long], [_person("alice", ("long",))], labor_law_averaging_weeks=2))

    assert _worked(result, "alice") != []


def test_the_law_is_stricter_than_a_shorter_rest_setting():
    late = _shift("late", start="14:00", end="22:00", weekdays=ALL_DAYS)
    early = _shift("early", start="06:00", end="14:00", weekdays=ALL_DAYS)
    alice = _person("alice", ("late", "early"))
    # 22:00 → 06:00 is 8 h: the setting allows it, ArbZG §5 does not.
    result = solve(_data([late, early], [alice], min_rest_hours=8))

    worked = {
        date.fromisoformat(str(e.date)): e.shift_id
        for e in next(p for p in result.employee_plans).daily_plan if e.status == "assigned"
    }
    assert worked, "a plan at all"
    for day, shift in worked.items():
        following = date.fromordinal(day.toordinal() + 1)
        assert not (shift == "late" and worked.get(following) == "early"), f"late {day} then early"


def test_the_weekly_average_caps_the_reference_period():
    # One-week reference period: 48 h, so at most four 10 h shifts of seven.
    long = {**_shift("long", start="07:00", end="18:00", weekdays=ALL_DAYS), "break_minutes": 60}
    result = solve(_data([long], [_person("alice", ("long",))], labor_law_averaging_weeks=1))

    assert len(_worked(result, "alice")) == 4


def test_hours_before_the_period_count_toward_the_average():
    long = {**_shift("long", start="07:00", end="18:00", weekdays=ALL_DAYS), "break_minutes": 60}
    # Two weeks' reference period = 96 h; 40 h worked in the week before.
    history = [{"employee_id": "alice", "date": f"2026-09-0{d}", "shift_id": "long"} for d in (1, 2, 3, 4)]
    result = solve(_data([long], [_person("alice", ("long",))], history=history, labor_law_averaging_weeks=2))

    assert len(_worked(result, "alice")) == 5  # 40 + 50 ≤ 96 < 40 + 60


# ---- Protected groups --------------------------------------------------------


def test_a_minor_works_at_most_eight_hours_five_days_and_no_sunday():
    day9 = _shift("day9", start="07:00", end="16:00", weekdays=ALL_DAYS)  # 9 h
    day8 = {**_shift("day8", start="07:00", end="15:30", weekdays=ALL_DAYS), "break_minutes": 30}  # 8 h net
    minor = _person("tim", ("day9", "day8"), date_of_birth="2010-01-01")
    result = solve(_data([day9, day8], [minor]))

    worked = _worked(result, "tim")
    assert _worked(result, "tim", "day9") == []
    assert date(2026, 9, 13) not in worked, "no Sunday"
    assert len(worked) <= 5


def test_minor_rules_end_on_the_eighteenth_birthday():
    day9 = _shift("day9", start="07:00", end="16:00", weekdays=ALL_DAYS)
    tim = _person("tim", ("day9",), date_of_birth="2008-09-10")  # 18 on Thursday
    result = solve(_data([day9], [tim]))

    worked = _worked(result, "tim")
    assert all(day >= date(2026, 9, 10) for day in worked)
    assert date(2026, 9, 10) in worked


def test_maternity_protection_rules_out_nights_and_sundays_without_saying_why():
    night = {**_shift("night", start="22:00", end="06:00", weekdays=ALL_DAYS), "is_night_shift": True}
    evening = _shift("evening", start="13:00", end="21:00", weekdays=ALL_DAYS)  # ends after 20:00
    early = _shift("early", start="06:00", end="14:00", weekdays=ALL_DAYS)
    mia = _person("mia", ("night", "evening", "early"), maternity_protection=True)
    result = solve(_data([night, evening, early], [mia]))

    worked = _worked(result, "mia")
    assert _worked(result, "mia", "night") == []
    assert _worked(result, "mia", "evening") == []
    assert date(2026, 9, 13) not in worked
    assert "MuSchG" in result.message
    for word in ("pregnan", "maternity", "mother"):
        assert word not in result.message.lower()


def test_protected_night_window():
    assert legal.touches_protected_night("13:00", "21:00")
    assert legal.touches_protected_night("22:00", "06:00")
    assert legal.touches_protected_night("05:00", "13:00")
    assert not legal.touches_protected_night("06:00", "14:00")
    assert not legal.touches_protected_night("12:00", "20:00")


def test_break_requirement():
    rules = legal.rules_for("arbzg_de")
    assert legal.required_break_minutes(rules, 6.0) == 0
    assert legal.required_break_minutes(rules, 6.5) == 30
    assert legal.required_break_minutes(rules, 9.5) == 45
    assert legal.rules_for("none") is None


def test_the_agent_carries_an_identical_copy():
    """The plan check must judge by the very rules the solver used."""
    here = Path(legal.__file__).read_text()
    copy = Path(__file__).resolve().parents[2] / "agent" / "shift_agent" / "agent" / "legal.py"
    assert copy.read_text() == here, "agent/shift_agent/agent/legal.py differs from planner/shift_planner/legal.py"
