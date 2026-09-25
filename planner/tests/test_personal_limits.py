"""Personal limits: per-employee caps on nights and weekends per month (hard or
soft by personal_limits_mode), never nights, and weekdays they would rather have
off."""

from shift_planner.optimizer import solve

from test_staffing import _emp, _shift, _ws

ALL_DAYS = ["0", "1", "2", "3", "4", "5", "6"]
# Mon 2026-09-07 … Sun 2026-09-20: two weekends.
TWO_WEEKS = {"start_date": "2026-09-07", "end_date": "2026-09-20"}


def _night(min_employees=1):
    night = _shift("night", start="22:00", end="06:00", min_employees=min_employees, weekdays=ALL_DAYS)
    return {**night, "is_night_shift": True}


def _data(shifts, employees, period=TWO_WEEKS, **constraints):
    return {
        "planning_period": period,
        "shifts": shifts,
        # One post per shift: whoever works it, the other does not.
        "workstations": [{**_ws("w1", shifts=[s["id"] for s in shifts]), "max_employees": 1}],
        "employees": employees,
        "constraints": {
            "solver_time_limit_seconds": 10,
            "solver_num_workers": 4,
            # Only the personal limit under test may keep anyone off.
            "max_working_days_per_week": 0,
            "max_consecutive_days": 0,
            "night_shift_recovery_days": 0,
            "min_rest_hours": 0,
            **constraints,
        },
    }


def _worked(result, employee_id, shift_id=None):
    plan = next(p for p in result.employee_plans if p.employee_id == employee_id)
    return [
        e.date for e in plan.daily_plan
        if e.status == "assigned" and (shift_id is None or e.shift_id == shift_id)
    ]


def _limited(eid, shifts, **limits):
    return {**_emp(eid, shifts=shifts), **limits}


def test_no_night_shifts_is_hard_even_if_the_slot_stays_empty():
    day = _shift("day", weekdays=ALL_DAYS)
    alice = _limited("alice", ("day", "night"), no_night_shifts=True)
    result = solve(_data([day, _night()], [alice]))

    assert _worked(result, "alice", "night") == []
    assert "Below minimum staffing" in result.message


def test_max_nights_hard_caps_the_month():
    alice = _limited("alice", ("night",), max_nights_per_month=3)
    result = solve(_data([_night()], [alice]))

    assert len(_worked(result, "alice", "night")) == 3
    assert "Personal limit" not in (result.message or "")


def test_max_nights_soft_gives_way_to_an_empty_slot_and_says_so():
    alice = _limited("alice", ("night",), max_nights_per_month=3)
    result = solve(_data([_night()], [alice], personal_limits_mode="soft"))

    assert len(_worked(result, "alice", "night")) == 14
    assert "Personal limit(s) exceeded: Alice: 14 nights in 2026-09 (max 3)" in result.message


def test_max_nights_soft_prefers_someone_without_a_limit():
    alice = _limited("alice", ("night",), max_nights_per_month=3)
    bob = _emp("bob", shifts=("night",))
    result = solve(_data([_night()], [alice, bob], personal_limits_mode="soft"))

    assert len(_worked(result, "alice", "night")) <= 3
    assert "Personal limit" not in (result.message or "")


def test_nights_count_per_calendar_month():
    # 2026-09-28 … 2026-10-04: three nights in September, four in October.
    period = {"start_date": "2026-09-28", "end_date": "2026-10-04"}
    alice = _limited("alice", ("night",), max_nights_per_month=2)
    result = solve(_data([_night()], [alice], period=period))

    worked = _worked(result, "alice", "night")
    assert sum(1 for d in worked if d.startswith("2026-09")) == 2
    assert sum(1 for d in worked if d.startswith("2026-10")) == 2


def test_max_weekends_counts_a_weekend_once_whichever_day_is_worked():
    day = _shift("day", weekdays=ALL_DAYS)
    alice = _limited("alice", ("day",), max_weekends_per_month=1)
    result = solve(_data([day], [alice]))

    weekend_days = {"2026-09-12", "2026-09-13", "2026-09-19", "2026-09-20"}
    worked_weekend = [d for d in _worked(result, "alice") if d in weekend_days]
    # Both days of one weekend, none of the other.
    assert len(worked_weekend) == 2
    assert worked_weekend in (["2026-09-12", "2026-09-13"], ["2026-09-19", "2026-09-20"])
    # Weekdays are untouched.
    assert len(_worked(result, "alice")) == 12


def test_preferred_days_off_are_kept_when_someone_else_can_cover():
    day = _shift("day", weekdays=ALL_DAYS)
    alice = _limited("alice", ("day",), preferred_days_off=["2"])  # Wednesdays
    bob = _emp("bob", shifts=("day",))
    # Priced like a one-off preferred day off (preference_weight), so hour
    # balancing and shift continuity would outweigh it here; switched off.
    result = solve(_data(
        [day], [alice, bob],
        equality_weight=0, shift_continuity_weight=0, shift_continuity_week_bonus=0,
    ))

    assert not {"2026-09-09", "2026-09-16"} & set(_worked(result, "alice"))


def test_preferred_days_off_never_leave_a_slot_empty():
    day = _shift("day", weekdays=ALL_DAYS)
    alice = _limited("alice", ("day",), preferred_days_off=["2"])
    result = solve(_data([day], [alice]))

    assert "2026-09-09" in _worked(result, "alice")
    assert "Below minimum staffing" not in (result.message or "")


def test_a_fixed_night_for_someone_who_does_no_nights_is_named():
    day = _shift("day", weekdays=ALL_DAYS)
    alice = {
        **_limited("alice", ("day", "night"), no_night_shifts=True),
        "fixed_shifts": [{"date": "2026-09-08", "shift_id": "night"}],
    }
    result = solve(_data([day, _night(min_employees=0)], [alice]))

    assert "Alice 2026-09-08 Night (they do not work night shifts)" in result.message
