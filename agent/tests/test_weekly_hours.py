"""Contract hours are weekly: the plan check and the replacement ranking hold
people to weekly hours × days / 7, as the solver does."""

from datetime import date

from shift_agent.agent.replacement import find_replacements
from shift_agent.agent.validation import validate

from test_replacement import DAY, _emp, _row, _rules


def _plan(employee_id, days):
    return {
        "employee_id": employee_id,
        "daily_plan": [
            {"date": f"2026-09-{d:02d}", "status": "assigned", "shift_id": "early", "workstation_id": "ward"}
            for d in days
        ],
    }


def _off_target(report):
    finding = next((f for f in report["findings"] if f["rule"] == "hours_off_target"), None)
    return finding["examples"] if finding else []


def test_the_check_prorates_weekly_hours_to_the_period():
    # September has 30 days. Ten 8-hour shifts are 80 h:
    # - Anna, 40 h a week → 171.4 h target: far off, flagged;
    # - Carla, 20 h a week → 85.7 h target: close enough;
    # - Ben, 0 → no target at all.
    employees = [
        _emp("anna", weekly_working_hours=40),
        _emp("ben", weekly_working_hours=0),
        _emp("carla", weekly_working_hours=20),
    ]
    days = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    result = {"employee_plans": [_plan(e, days) for e in ("anna", "ben", "carla")]}

    examples = _off_target(validate(_rules(employees), result))

    assert len(examples) == 1, examples
    assert examples[0].startswith("Anna — 80.0 h against a target of 171.4 h")


def test_replacement_targets_are_the_month_of_weekly_hours():
    # 35 h a week over September's 30 days is 150 h.
    answer = find_replacements(
        _rules([_emp("anna"), _emp("ben", weekly_working_hours=35)]),
        [_row("anna", "2026-09-16")], "anna", DAY,
    )
    ben = answer["candidates"][0]
    assert ben["target_hours"] == 150.0
    assert ben["hours_below_target"] == 150.0
