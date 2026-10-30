"""The plan check, repair, replacement search and swap check as MCP tools
(mcp/agent_tools.py): the same answers as the engines behind the agent's HTTP
routes, errors as {"error": …}, and an instruction that needs a model refused
— with nothing saved — when there is none."""

import asyncio
import json
from datetime import date

import httpx
import pytest
from fastmcp import FastMCP

from shift_agent.agent import replacement, validation
from shift_agent.mcp.agent_tools import NO_LLM, register_agent_tools
from shift_agent.mcp.auth import BackendTokenAuth
from shift_agent.mcp.server import _load_openapi_spec

from test_replacement import _emp, _row, _rules

DAY = date(2026, 9, 16)
RESULT_ID = "11111111-1111-1111-1111-111111111111"


def _plan(employee_id, days):
    return {
        "employee_id": employee_id,
        "daily_plan": [
            {"date": f"2026-09-{d:02d}", "status": "assigned", "shift_id": "early", "workstation_id": "ward"} for d in days
        ],
    }


class Backend:
    """One set of backend data, served over HTTP to the MCP server and as a
    plain `call_mcp` to the engines directly — so the two can be compared."""

    def __init__(self):
        # Anna is unavailable on the 16th and planned anyway: a hard violation.
        self.rules = _rules([_emp("anna", unavailability=["2026-09-16"]), _emp("ben"), _emp("carla")])
        self.result = {
            "planning_period": {"start_date": "2026-09-01", "end_date": "2026-09-30"},
            "employee_plans": [_plan("anna", [15, 16]), _plan("ben", [17])],
        }
        self.roster = [_row("anna", "2026-09-16"), _row("ben", "2026-09-17", "late")]
        self.saved: list[dict] = []

    def answer(self, operation: str, args: dict):
        if operation == "getOptimizedShift":
            if args["resultId"] != RESULT_ID:
                return 404, {"error": "No such result"}
            return 200, {"id": RESULT_ID, "result": self.result}
        if operation == "preparePlan":
            return 200, self.rules
        if operation == "listCapabilities":
            return 200, {"data": [{"id": "care", "name": "Care"}], "total": 1}
        if operation == "listConfirmedShiftPlans":
            return 200, {"data": self.roster, "total": len(self.roster)}
        if operation == "updateOptimizedShift":
            self.saved.append(args)
            return 200, {"id": RESULT_ID}
        raise AssertionError(f"unexpected {operation}")

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        if path.startswith("/api/v1/planner/optimized-shifts/"):
            rid = path.rsplit("/", 1)[-1]
            if method == "GET":
                status, body = self.answer("getOptimizedShift", {"resultId": rid})
            else:
                status, body = self.answer("updateOptimizedShift", {"resultId": rid, **json.loads(request.content)})
        elif path == "/api/v1/planner/prepare":
            status, body = self.answer("preparePlan", json.loads(request.content))
        elif path == "/api/v1/capabilities":
            status, body = self.answer("listCapabilities", {})
        elif path == "/api/v1/confirmed-shift-plans":
            status, body = self.answer("listConfirmedShiftPlans", dict(request.url.params))
        else:
            raise AssertionError(f"unexpected {method} {path}")
        return httpx.Response(status, json=body)

    def call_mcp(self, operation: str, args: dict) -> str:
        status, body = self.answer(operation, args)
        return json.dumps(body if status < 400 else {"error": body["error"]})


@pytest.fixture
def backend():
    return Backend()


def server(backend: Backend, llm_provider=lambda: None) -> FastMCP:
    client = httpx.AsyncClient(
        base_url="http://backend/api/v1", transport=httpx.MockTransport(backend.handler), auth=BackendTokenAuth()
    )
    mcp = FastMCP.from_openapi(openapi_spec=_load_openapi_spec(), client=client)
    register_agent_tools(mcp, llm_provider=llm_provider)
    return mcp


def call(mcp: FastMCP, tool: str, args: dict) -> dict:
    result = asyncio.run(mcp.call_tool(tool, args))
    return json.loads(result.content[0].text)


def same(value) -> dict:
    """Through JSON, as both answers reach a client."""
    return json.loads(json.dumps(value, default=str))


def test_the_plan_check_matches_the_engine_behind_verify_plan(backend):
    answer = call(server(backend), "validateOptimizedPlan", {"result_id": RESULT_ID})

    rules, result, names = validation.collect(backend.call_mcp, RESULT_ID)
    expected = validation.validate(rules, result, names)
    expected["result_id"] = RESULT_ID
    expected["headline"] = validation.headline(expected)
    assert answer == same(expected)
    assert answer["error_count"] >= 1


def test_an_unknown_result_is_an_error_not_a_report(backend):
    answer = call(server(backend), "validateOptimizedPlan", {"result_id": "22222222-2222-2222-2222-222222222222"})
    assert set(answer) == {"error"}


def test_the_replacement_search_matches_find_replacement(backend):
    answer = call(server(backend), "findReplacement", {"employee_id": "anna", "date": "2026-09-16"})
    assert answer == same(replacement.search(backend.call_mcp, "anna", DAY))
    assert [c["employee_id"] for c in answer["candidates"]]


def test_no_shift_that_day_is_an_error(backend):
    answer = call(server(backend), "findReplacement", {"employee_id": "carla", "date": "2026-09-16"})
    assert set(answer) == {"error"}


def test_the_swap_check_matches_the_backends_swap_review(backend):
    args = {"requester": {"employee_id": "anna", "date": "2026-09-16"}, "colleague": {"employee_id": "ben", "date": "2026-09-17"}}
    answer = call(server(backend), "checkShiftSwap", args)
    assert answer == same(replacement.check_swap(backend.call_mcp, "anna", DAY, "ben", date(2026, 9, 17)))
    assert len(answer["employees"]) == 2


class Spy:
    def __init__(self, llm):
        self.llm, self.built = llm, 0

    def __call__(self):
        self.built += 1
        return self.llm


class StubLLM:
    def __init__(self, reply=None, fail=False):
        self.reply, self.fail = reply, fail

    def invoke(self, messages):
        if self.fail:
            raise ConnectionError("model unreachable")
        return type("Reply", (), {"content": json.dumps(self.reply)})()


def test_a_repair_without_instruction_never_builds_a_model_and_saves(backend):
    spy = Spy(StubLLM())
    answer = call(server(backend, spy), "repairOptimizedPlan", {"result_id": RESULT_ID})
    assert spy.built == 0
    assert answer["after"]["error_count"] == 0
    assert len(backend.saved) == 1


def test_an_instruction_without_a_model_is_refused_and_nothing_is_saved(backend):
    answer = call(server(backend, Spy(None)), "repairOptimizedPlan", {"result_id": RESULT_ID, "instruction": "Ben is off on the 17th"})
    assert answer == {"error": NO_LLM}
    assert backend.saved == []


def test_an_unreachable_model_is_refused_too_and_nothing_is_saved(backend):
    answer = call(server(backend, Spy(StubLLM(fail=True))), "repairOptimizedPlan", {"result_id": RESULT_ID, "instruction": "Ben is off on the 17th"})
    assert answer == {"error": NO_LLM}
    assert backend.saved == []


def test_an_instruction_read_by_the_model_is_carried_out_and_saved(backend):
    reply = {"unassign": [{"employee": "Ben", "date": "2026-09-17"}], "understood": "Take Ben off on the 17th."}
    spy = Spy(StubLLM(reply))
    answer = call(server(backend, spy), "repairOptimizedPlan", {"result_id": RESULT_ID, "instruction": "Ben is off on the 17th"})
    assert spy.built == 1
    assert answer["understood"] == "Take Ben off on the 17th."
    assert len(backend.saved) == 1
    ben = next(p for p in backend.saved[0]["employee_plans"] if p["employee_id"] == "ben")
    assert not any(d["date"] == "2026-09-17" and d.get("status") == "assigned" for d in ben["daily_plan"])
