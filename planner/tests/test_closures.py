"""Closed workstations: for a period (`unavailability`) or completely
(`available: false`). Nobody is planned there, a closed slot is not a gap, and
whatever still points at one — a lock, a hand-made plan — is named."""

from shift_planner.models import SchedulingInput, validate_output
from shift_planner.optimizer import solve

from test_staffing import _emp, _input, _shift, _staffed, _ws

MONDAY, TUESDAY, WEDNESDAY = "2026-09-07", "2026-09-08", "2026-09-09"


def _closed(ws, from_date, to_date):
    return {**ws, "unavailability": [{"from_date": from_date, "to_date": to_date}]}


def test_nobody_is_planned_inside_a_closure_period():
    result = solve(_input(
        [_shift("day")],
        [_closed(_ws("ward"), TUESDAY, WEDNESDAY), _ws("clinic")],
        [_emp("alice"), _emp("bob")],
    ))

    staffed = _staffed(result)
    assert staffed.get((MONDAY, "day", "ward"), 0) >= 1
    for day in (TUESDAY, WEDNESDAY):
        assert staffed.get((day, "day", "ward"), 0) == 0
    # Open days are still covered, so nothing is reported short.
    assert result.message is None


def test_a_deactivated_workstation_is_never_planned():
    result = solve(_input(
        [_shift("day")],
        [{**_ws("ward"), "available": False}, _ws("clinic")],
        [_emp("alice"), _emp("bob")],
    ))

    assert result.status in ("optimal", "feasible")
    assert not any(ws == "ward" for (_, _, ws) in _staffed(result))
    assert result.message is None


def test_a_shift_with_every_station_closed_is_not_reported_short():
    # The shift wants 2 people, but its only workstation is closed on Tuesday:
    # there is nowhere to put them, so Tuesday is not a gap.
    result = solve(_input(
        [_shift("day", min_employees=2, weekdays=["0", "1"])],
        [_closed(_ws("ward"), TUESDAY, TUESDAY)],
        [_emp("alice"), _emp("bob")],
    ))

    assert result.message is None


def test_a_lock_on_a_closed_workstation_is_dropped_and_named():
    result = solve({
        **_input(
            [_shift("day")],
            [_closed(_ws("ward"), TUESDAY, TUESDAY), _ws("clinic")],
            [_emp("alice"), _emp("bob")],
        ),
        "locked_assignments": [
            {"employee_id": "alice", "date": TUESDAY, "shift_id": "day", "workstation_id": "ward"},
        ],
    })

    assert result.status in ("optimal", "feasible")
    assert "the workstation is closed that day" in result.message


def test_output_check_flags_an_assignment_at_a_closed_workstation():
    data = _input(
        [_shift("day", weekdays=["0"])],
        [_closed(_ws("ward"), MONDAY, MONDAY), {**_ws("clinic"), "available": False}],
        [_emp("alice"), _emp("bob")],
    )
    output = {
        "schedule": [{
            "date": MONDAY,
            "shifts": [{
                "shift_id": "day",
                "assigned_dates": [
                    {"employee_id": "alice", "workstation_id": "ward"},
                    {"employee_id": "bob", "workstation_id": "clinic"},
                ],
            }],
        }],
    }

    violations = validate_output(output, SchedulingInput(**data))

    closed = [v for v in violations if v.startswith("Closed workstation")]
    assert len(closed) == 2, violations
