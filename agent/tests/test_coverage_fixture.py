"""The Analytics page counts staffing shortfalls in the browser
(ui/.../analytics/model/coverage.ts). It must count them the way the plan
check does, so both run the same fixture and must agree with its `expected`."""

import json
import re
from pathlib import Path

from shift_agent.agent.validation import MAX_EXAMPLES, validate

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "ui" / "src" / "app" / "pages" / "reports" / "analytics" / "model" / "coverage.fixture.json"
)


def _rules(fx):
    return {
        "planning_period": {"start_date": fx["period"]["from"], "end_date": fx["period"]["to"]},
        "holidays": fx["holidays"],
        "shifts": [
            {
                "id": s["id"], "name": s["name"], "is_night_shift": False,
                "weekday_times": [
                    {"weekday": str(w["weekday"]), "start_time": s["start"], "end_time": s["end"],
                     "min_employees": w["min"], "max_employees": w["max"]}
                    for w in s["weekday"]
                ],
            }
            for s in fx["shifts"]
        ],
        "workstations": [
            {
                "id": w["id"], "name": w["name"], "available": w["available"], "required_skills": [],
                "operating_shifts": w["active_shift_ids"], "min_employees": w["min"], "max_employees": w["max"],
                "unavailability": [{"from_date": c["from"], "to_date": c["to"]} for c in w["closures"]],
            }
            for w in fx["workstations"]
        ],
        "employees": [
            {"id": e, "name": e, "skills": [], "available_shifts": [s["id"] for s in fx["shifts"]]}
            for e in fx["employees"]
        ],
        # Only staffing is under test: switch off what would add other findings.
        "constraints": {"max_working_days_per_week": 0, "max_consecutive_days": 0, "min_rest_hours": 0},
    }


def _result(fx):
    plans = {}
    for a in fx["assignments"]:
        plans.setdefault(a["employee"], []).append(
            {"date": a["date"], "status": "assigned", "shift_id": a["shift"], "workstation_id": a["workstation"]}
        )
    return {"employee_plans": [{"employee_id": e, "daily_plan": days} for e, days in plans.items()]}


# "2026-09-12 · Early — 1 of 2 needed" / "2026-09-11 · Early · ER — 2 of at most 1"
EXAMPLE = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2}) · (?P<shift>[^·]+?)(?: · (?P<workstation>[^—]+?))? — "
    r"(?P<staffed>\d+) of (?:at most )?(?P<bound>\d+)"
)


def _found(report, rule, fx):
    finding = next((f for f in report["findings"] if f["rule"] == rule), None)
    if finding is None:
        return []
    assert finding["count"] <= MAX_EXAMPLES, "the fixture must stay small enough to list every example"
    shift_ids = {s["name"]: s["id"] for s in fx["shifts"]}
    station_ids = {w["name"]: w["id"] for w in fx["workstations"]}
    bound = "max" if rule.endswith("over_max") else "min"
    rows = []
    for example in finding["examples"]:
        m = EXAMPLE.match(example)
        assert m, example
        row = {"date": m["date"], "shift": shift_ids[m["shift"]]}
        if m["workstation"]:
            row["workstation"] = station_ids[m["workstation"]]
        row["staffed"] = int(m["staffed"])
        row[bound] = int(m["bound"])
        rows.append(row)
    return sorted(rows, key=lambda r: (r["date"], r.get("workstation", "")))


def test_the_plan_check_agrees_with_the_analytics_fixture():
    fx = json.loads(FIXTURE.read_text())
    report = validate(_rules(fx), _result(fx))
    for rule in ("shift_under_min", "workstation_under_min", "shift_over_max", "workstation_over_max"):
        assert _found(report, rule, fx) == fx["expected"][rule], rule
