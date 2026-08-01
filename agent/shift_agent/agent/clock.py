"""
The agent's clock — one local tool, ``currentDateTime``.

A language model has no idea what day it is: its weights were frozen months
ago, and nothing in the conversation says otherwise. Yet almost every question
a ward manager asks is anchored to now — "how many people work **today**", "who
is on the late shift **tomorrow**", "is anyone off **this week**". Those all
turn into a backend call that wants concrete dates (``from_date``/``to_date``),
so the agent has to learn the date before it can ask.

Hence this tool rather than a date stamped into the system prompt: the graph is
a process-wide singleton built once and reused for the life of the process, so
anything baked into the prompt at startup would be wrong by the next morning.

It returns more than the date. Resolving "this week" or "next month" from a
bare date means calendar arithmetic that models get wrong at month and year
boundaries, so the ranges come precomputed — the agent copies them into the
query instead of calculating them.

Weekday numbering matches the rest of the system (0 = Monday … 6 = Sunday, as
in a shift's ``weekday_times``), so the answer can be used directly against the
shift configuration.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from langchain_core.tools import StructuredTool

from shift_agent.config import settings

logger = logging.getLogger(__name__)

_WEEKDAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]


def _zone() -> ZoneInfo | None:
    """The configured timezone, or None for the host's local time."""
    name = (settings.timezone or "").strip()
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning(
            "SHIFT_AGENT_TIMEZONE=%r is not a known IANA timezone — using local time",
            name,
        )
        return None


def _month_end(day: date) -> date:
    """Last day of ``day``'s month."""
    first_of_next = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
    return first_of_next - timedelta(days=1)


def now_reference(moment: datetime | None = None) -> dict:
    """Everything the agent needs to turn "today" or "this week" into dates.

    Args:
        moment: the instant to describe. Defaults to now in the configured
            timezone; injected by the tests.
    """
    if moment is None:
        moment = datetime.now(_zone())

    today = moment.date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)

    return {
        "date": today.isoformat(),
        "time": moment.strftime("%H:%M:%S"),
        "datetime": moment.isoformat(timespec="seconds"),
        "weekday": _WEEKDAY_NAMES[today.weekday()],
        # Same numbering as a shift's weekday_times, so it can be used as-is.
        "weekday_number": today.weekday(),
        "timezone": str(moment.tzinfo) if moment.tzinfo else "local time",
        "yesterday": (today - timedelta(days=1)).isoformat(),
        "tomorrow": (today + timedelta(days=1)).isoformat(),
        "this_week": {
            "iso_week": today.isocalendar().week,
            "from_date": week_start.isoformat(),
            "to_date": (week_start + timedelta(days=6)).isoformat(),
        },
        "next_week": {
            "from_date": (week_start + timedelta(days=7)).isoformat(),
            "to_date": (week_start + timedelta(days=13)).isoformat(),
        },
        "this_month": {
            "name": moment.strftime("%B %Y"),
            "from_date": month_start.isoformat(),
            "to_date": _month_end(today).isoformat(),
        },
    }


def build_clock_tools() -> list[StructuredTool]:
    """The agent's date and time tool. Always available — no configuration."""

    def current_date_time() -> str:
        return json.dumps(now_reference(), indent=2)

    return [
        StructuredTool.from_function(
            func=current_date_time,
            name="currentDateTime",
            description=(
                "Get the current date, time and weekday, plus ready-made date ranges "
                "for this week, next week and this month. Call this FIRST for any "
                "question about 'today', 'now', 'tomorrow', 'this week', 'this month' "
                "or any other relative time — you do not otherwise know what day it "
                "is, and the backend tools need concrete YYYY-MM-DD dates. Takes no "
                "arguments. weekday_number is 0=Monday … 6=Sunday, the same numbering "
                "a shift's weekday times use."
            ),
        )
    ]
