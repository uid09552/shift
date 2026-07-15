"""
The `navigate` tool doesn't call the backend — it resolves a page name to a
frontend route. The Flask layer (see server.py) picks the tool's result back
out of the message history and returns it to the caller as a `ui_action`, so
the website's chat widget can perform the actual `router.navigate()`.
"""

import json

from langchain_core.tools import tool

# Keep in sync with ui/src/app/app.routes.ts
KNOWN_PAGES = {
    "dashboard": "/",
    "schedule": "/kalender",
    "employee_calendar": "/employee-calendar",
    "workstation_calendar": "/workstation-calendar",
    "scheduler": "/scheduler",
    "user_profiles": "/user-profiles",
    "shifts": "/shifts",
    "workstations": "/workstations",
    "capabilities": "/capabilities",
    "planner_settings": "/planner-settings",
}


@tool
def navigate(page: str) -> str:
    """Send the user's browser to a page in the app.

    Args:
        page: One of: dashboard, schedule, employee_calendar, workstation_calendar,
            scheduler, user_profiles, shifts, workstations, capabilities, planner_settings.
    """
    path = KNOWN_PAGES.get(page)
    if not path:
        return json.dumps({
            "error": f"Unknown page '{page}'. Valid pages: {', '.join(sorted(KNOWN_PAGES))}",
        })
    return json.dumps({"action": "navigate", "path": path})
