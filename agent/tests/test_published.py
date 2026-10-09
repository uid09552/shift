"""A published roster: what employees have been told. The optimizer tool hands
`published_roster` from the backend's prepare straight to the solver, a
re-solve carries the solver's change count back, and the plan check counts the
changes against it the way the solver does."""

import asyncio
import json

import httpx

from shift_agent.agent.repair import Directives, resolve_with_optimizer
from shift_agent.agent.validation import headline, validate
from shift_agent.mcp import server

from test_replacement import _emp, _rules

PUBLISHED = [
    {"employee_id": "anna", "date": "2026-09-16", "shift_id": "early", "workstation_id": "ward"},
    {"employee_id": "anna", "date": "2026-09-17", "shift_id": None, "workstation_id": None},
    {"employee_id": "ben", "date": "2026-09-16", "shift_id": None, "workstation_id": None},
]


class _Capture:
    """Stands in for FastMCP: keeps the function `@mcp.tool` decorates."""

    def tool(self, fn):
        self.fn = fn
        return fn


def test_optimize_schedule_passes_the_published_roster_to_the_solver(monkeypatch):
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/planner/prepare"):
            return httpx.Response(200, json={
                **_rules([_emp("anna")]),
                "published_roster": PUBLISHED,
            })
        if request.url.path.endswith("/api/v1/optimize"):
            sent.update(json.loads(request.content))
            return httpx.Response(200, json={
                "status": "optimal", "objective_value": 1.0,
                "planning_period": {"start_date": "2026-09-01", "end_date": "2026-09-30"},
                "schedule": [], "employee_plans": [], "message": None,
                "changes_vs_published": 2,
            })
        return httpx.Response(404)

    real = httpx.AsyncClient
    monkeypatch.setattr(
        server.httpx, "AsyncClient",
        lambda *a, **kw: real(*a, **{**kw, "transport": httpx.MockTransport(handler)}),
    )
    capture = _Capture()
    server._register_optimizer(capture)

    answer = json.loads(asyncio.run(capture.fn(
        start_date="2026-09-01", end_date="2026-09-30", constraints={"change_weight": 0},
    )))

    assert sent["published_roster"] == PUBLISHED, "passed through as prepare built it"
    assert sent["constraints"]["change_weight"] == 0, "a per-run override the tool accepts"
    assert answer["changes_vs_published"] == 2


def test_a_resolve_carries_the_solvers_change_count():
    def call_mcp(tool, arguments):
        assert tool == "optimizeSchedule"
        return json.dumps({
            "status": "feasible", "objective_value": 3.0, "message": None,
            "employee_plans": [], "schedule": [], "changes_vs_published": 1,
        })

    rules = {**_rules([_emp("anna")]), "published_roster": PUBLISHED}
    rebuilt, _note = resolve_with_optimizer(call_mcp, rules, {"employee_plans": []}, Directives(), [])
    assert rebuilt["changes_vs_published"] == 1


def _plan(employee_id, *days):
    """`days`: (date, shift or None)."""
    return {
        "employee_id": employee_id,
        "daily_plan": [
            {"date": d, "status": "assigned", "shift_id": s, "workstation_id": "ward"} if s
            else {"date": d, "status": "free"}
            for d, s in days
        ],
    }


def test_the_plan_check_counts_changes_against_the_published_roster():
    rules = {**_rules([_emp("anna"), _emp("ben")]), "published_roster": PUBLISHED}
    result = {"employee_plans": [
        _plan("anna", ("2026-09-16", "late"), ("2026-09-17", None)),   # 16th changed
        _plan("ben", ("2026-09-16", "early")),                        # 16th changed
    ]}

    report = validate(rules, result)
    assert report["stats"]["changes_vs_published"] == 2
    assert "2 change(s) to the published roster" in headline(report)


def test_without_a_published_roster_the_check_reports_no_count():
    report = validate(_rules([_emp("anna")]), {"employee_plans": [_plan("anna", ("2026-09-16", "early"))]})
    assert report["stats"]["changes_vs_published"] is None
