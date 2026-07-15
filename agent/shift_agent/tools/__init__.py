from shift_agent.tools.backend_api import (
    get_planner_settings,
    list_capabilities,
    list_employees,
    list_shifts,
    list_workstations,
    update_planner_settings,
)
from shift_agent.tools.navigation import navigate

ALL_TOOLS = [
    navigate,
    list_shifts,
    list_workstations,
    list_capabilities,
    list_employees,
    get_planner_settings,
    update_planner_settings,
]
