"""Labor-law rule sets (`constraints.labor_law_profile`).

One profile today, `arbzg_de`: the German Arbeitszeitgesetz for everyone, the
Jugendarbeitsschutzgesetz for employees under 18 and the Mutterschutzgesetz for
employees with maternity protection. `none` applies no legal rule at all — the
tenant's own settings are all there is.

This module is plain Python on purpose: the solver (``optimizer.py``) holds the
rules as hard constraints and the agent's plan check
(``agent/shift_agent/agent/legal.py``, an identical copy — the agent ships
without the planner package) reports breaches of them. A test in
``planner/tests/test_legal.py`` fails when the two copies drift apart.

What is modelled is a subset of the law, and not legal advice:

- ArbZG §3   at most 10 h a working day; on average at most 48 h a week over
             the reference period (`labor_law_averaging_weeks`, 24)
- ArbZG §4   30 min break above 6 h, 45 min above 9 h (checked against the
             shift's `break_minutes`)
- ArbZG §5   11 h rest between two shifts
- JArbSchG   under 18: 8 h a day, 40 h and 5 days a week, 12 h rest, no work
             20:00–06:00, no Sundays or public holidays
- MuSchG     maternity protection: 8.5 h a day, 90 h a double week, no work
             20:00–06:00, no Sundays or public holidays

Hours are net: a shift's span minus its `break_minutes`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

PROFILES = ("none", "arbzg_de")

# Statutes cited in plan-check findings.
ARBZG_DAY = "ArbZG §3"
ARBZG_AVERAGE = "ArbZG §3"
ARBZG_BREAK = "ArbZG §4"
ARBZG_REST = "ArbZG §5"
JARBSCHG_HOURS = "JArbSchG §8"
JARBSCHG_REST = "JArbSchG §13"
JARBSCHG_NIGHT = "JArbSchG §14"
JARBSCHG_WEEK = "JArbSchG §15"
JARBSCHG_SUNDAY = "JArbSchG §17, §18"
MUSCHG_HOURS = "MuSchG §4"
MUSCHG_NIGHT = "MuSchG §5"
MUSCHG_SUNDAY = "MuSchG §6"

# The window protected groups may not work in: 20:00 to 06:00.
_PROTECTED_NIGHT_START = 20 * 60
_PROTECTED_NIGHT_END = 6 * 60


@dataclass(frozen=True)
class LegalRules:
    """What a profile demands of everyone."""

    profile: str
    max_day_hours: float = 10.0
    average_week_hours: float = 48.0
    averaging_weeks: int = 24
    min_rest_hours: float = 11.0
    # (gross hours above which, break minutes required), longest first.
    break_tiers: tuple = ((9.0, 45), (6.0, 30))


@dataclass(frozen=True)
class PersonRules:
    """What applies to one employee on one day: the general rules, tightened
    for a protected group. `group` is "minor", "maternity" or None — never
    shown to anyone as a reason (see `group_label`)."""

    max_day_hours: float
    min_rest_hours: float
    no_protected_night: bool = False
    no_sunday_or_holiday: bool = False
    max_week_hours: float | None = None
    max_week_days: int | None = None
    max_double_week_hours: float | None = None
    group: str | None = None

    @property
    def day_statute(self) -> str:
        return {"minor": JARBSCHG_HOURS, "maternity": MUSCHG_HOURS}.get(self.group or "", ARBZG_DAY)

    @property
    def rest_statute(self) -> str:
        return JARBSCHG_REST if self.group == "minor" else ARBZG_REST

    @property
    def night_statute(self) -> str:
        return MUSCHG_NIGHT if self.group == "maternity" else JARBSCHG_NIGHT

    @property
    def sunday_statute(self) -> str:
        return MUSCHG_SUNDAY if self.group == "maternity" else JARBSCHG_SUNDAY


def rules_for(profile: str | None, averaging_weeks: int | None = None) -> LegalRules | None:
    """The rule set of a profile, or None for `none` (and anything unknown)."""
    if profile != "arbzg_de":
        return None
    return LegalRules(profile=profile, averaging_weeks=int(averaging_weeks or 24))


def _as_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def is_minor(date_of_birth, day: date) -> bool:
    """Under 18 on `day` — the birthday itself is the first adult day."""
    born = _as_date(date_of_birth)
    if born is None:
        return False
    try:
        adult = born.replace(year=born.year + 18)
    except ValueError:  # born on 29 February
        adult = born.replace(year=born.year + 18, day=28) + timedelta(days=1)
    return day < adult


def person_rules(rules: LegalRules, employee: dict, day: date) -> PersonRules:
    """The rules for `employee` on `day`. A minor with maternity protection
    gets the stricter value of each."""
    minor = is_minor(employee.get("date_of_birth"), day)
    maternity = bool(employee.get("maternity_protection"))
    if not minor and not maternity:
        return PersonRules(max_day_hours=rules.max_day_hours, min_rest_hours=rules.min_rest_hours)
    day_hours = rules.max_day_hours
    if maternity:
        day_hours = min(day_hours, 8.5)
    if minor:
        day_hours = min(day_hours, 8.0)
    return PersonRules(
        max_day_hours=day_hours,
        min_rest_hours=max(rules.min_rest_hours, 12.0 if minor else 0.0),
        no_protected_night=True,
        no_sunday_or_holiday=True,
        max_week_hours=40.0 if minor else None,
        max_week_days=5 if minor else None,
        max_double_week_hours=90.0 if maternity else None,
        group="minor" if minor else "maternity",
    )


def group_label(person: PersonRules) -> str:
    """How a protected-group rule is named to people: the law, never the
    reason it applies (age or pregnancy are nobody's business on a roster)."""
    return "protected-group rule"


def required_break_minutes(rules: LegalRules, gross_hours: float) -> int:
    """Break the law asks for a shift of `gross_hours` (span incl. the break)."""
    for above, minutes in rules.break_tiers:
        if gross_hours > above:
            return minutes
    return 0


def net_hours(gross_hours: float, break_minutes: int | None) -> float:
    return max(0.0, gross_hours - (break_minutes or 0) / 60.0)


def _minutes(value) -> int:
    if isinstance(value, str):
        h, m = value.split(":")[:2]
        return int(h) * 60 + int(m)
    return value.hour * 60 + value.minute


def touches_protected_night(start_time, end_time) -> bool:
    """Whether a shift running start→end (past midnight when end ≤ start)
    overlaps 20:00–06:00 on any day."""
    start = _minutes(start_time)
    end = _minutes(end_time)
    if end <= start:
        end += 24 * 60
    # Night windows that can meet a shift starting on day 0: the one ending
    # 06:00 that morning, the one from 20:00 that evening into day 1.
    for night_start, night_end in (
        (_PROTECTED_NIGHT_START - 24 * 60, _PROTECTED_NIGHT_END),
        (_PROTECTED_NIGHT_START, _PROTECTED_NIGHT_END + 24 * 60),
    ):
        if start < night_end and night_start < end:
            return True
    return False


def is_sunday_or_holiday(day: date, holidays=()) -> bool:
    return day.weekday() == 6 or day in holidays
