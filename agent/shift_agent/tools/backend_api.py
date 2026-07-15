"""
Tools that call the Rust backend's REST API (see api/openapi.yaml) to look up
or change real configuration. Each tool returns the backend's JSON response
as a string so the model can read it directly.
"""

import json

import httpx
from langchain_core.tools import tool

from shift_agent.config import settings


def _client() -> httpx.Client:
    headers = {}
    if settings.backend_access_token:
        headers["x-access-token"] = settings.backend_access_token
    return httpx.Client(base_url=settings.backend_api_url, headers=headers, timeout=10.0)


def _get(path: str) -> str:
    with _client() as client:
        response = client.get(path)
        response.raise_for_status()
        return json.dumps(response.json())


@tool
def list_shifts() -> str:
    """List all configured shift types: name, short name, color, and weekday times."""
    return _get("/shifts")


@tool
def list_workstations() -> str:
    """List all workstations/departments, including required capabilities and staffing minimums."""
    return _get("/workstations")


@tool
def list_capabilities() -> str:
    """List all capabilities/skills that employees can hold and workstations can require."""
    return _get("/capabilities")


@tool
def get_planner_settings() -> str:
    """Get the tenant's current shift-optimizer algorithm settings (rest rules,
    fairness/priority weights, solver performance)."""
    return _get("/planner-settings")


@tool
def update_planner_settings(
    night_shift_recovery_days: int,
    min_rest_hours: float,
    max_consecutive_days: int,
    max_working_days_per_week: int,
    equality_weight: int,
    priority_weight_high: int,
    priority_weight_medium: int,
    priority_weight_low: int,
    monthly_hours_target_weight: int,
    solver_time_limit_seconds: float,
    solver_num_workers: int,
) -> str:
    """Update the tenant's shift-optimizer algorithm settings.

    All fields are required by the backend. Call get_planner_settings first,
    change only the field(s) the user asked about, and pass every other field
    back unchanged.

    Args:
        night_shift_recovery_days: Days off required after a night shift (0-7, 0 disables).
        min_rest_hours: Minimum rest between shifts on consecutive days (0-24).
        max_consecutive_days: Longest allowed run of working days (0-14, 0 disables).
        max_working_days_per_week: Max working days per calendar week (0-7, 0 disables).
        equality_weight: Objective weight for balancing hours across employees (>= 0).
        priority_weight_high: Objective weight for staffing high-priority workstations (>= 0).
        priority_weight_medium: Objective weight for staffing medium-priority workstations (>= 0).
        priority_weight_low: Objective weight for staffing low-priority workstations (>= 0).
        monthly_hours_target_weight: Objective weight for meeting monthly hours targets (>= 0).
        solver_time_limit_seconds: Max solver runtime in seconds (> 0).
        solver_num_workers: Parallel solver worker threads (1-64).
    """
    payload = {
        "night_shift_recovery_days": night_shift_recovery_days,
        "min_rest_hours": min_rest_hours,
        "max_consecutive_days": max_consecutive_days,
        "max_working_days_per_week": max_working_days_per_week,
        "equality_weight": equality_weight,
        "priority_weights": {
            "high": priority_weight_high,
            "medium": priority_weight_medium,
            "low": priority_weight_low,
        },
        "monthly_hours_target_weight": monthly_hours_target_weight,
        "solver_time_limit_seconds": solver_time_limit_seconds,
        "solver_num_workers": solver_num_workers,
    }
    with _client() as client:
        response = client.put("/planner-settings", json=payload)
        if response.status_code == 400:
            return json.dumps({"error": response.json().get("error", "Invalid settings")})
        response.raise_for_status()
        return json.dumps(response.json())


@tool
def list_employees() -> str:
    """List employees (name, email, monthly working hours target)."""
    return _get("/employees?limit=100")
