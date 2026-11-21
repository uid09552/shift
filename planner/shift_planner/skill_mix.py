"""Skill-mix and pairing rules: who has to — or may not — work alongside whom.

Kept free of the solver so the same rules can be read, and a plan checked
against them, wherever a plan is looked at. The solver
(``planner/shift_planner/optimizer.py``) builds its constraints from the
matchers here and reports breaches with :func:`check`; the agent's plan check
and repair use an identical copy (``agent/shift_agent/agent/skill_mix.py``, a
test fails on drift).

Skill mix — per slot, i.e. per day and shift, at one workstation or (without a
``workstation_id``) summed over every workstation running that shift:

- ``at_least``: of the people on a staffed slot, at least ``count`` hold the
  ``capability`` — or a higher level of its skill group — or, without a
  capability, any capability of ``skill_group`` at ``min_level`` or above
  ("at least one level ≥ 3 nurse per shift"). An empty slot breaks nothing.
- ``at_most``: at most ``count`` of them hold ``capability`` exactly
  ("at most two trainees").

Pairing — between two employees:

- ``mentor``: ``employee_id`` (the trainee) works only on a shift and at a
  workstation where ``partner_id`` (the mentor) works too.
- ``together``: on a day both work, they work the same shift.
- ``apart``: they never work the same shift on the same day.

Every rule is ``hard`` (the solver may not break it) or ``soft`` (broken only
where staffing coverage needs it, and then named in the result).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Iterable

AT_LEAST = "at_least"
AT_MOST = "at_most"
MENTOR = "mentor"
TOGETHER = "together"
APART = "apart"

MIX_KINDS = (AT_LEAST, AT_MOST)
PAIR_KINDS = (MENTOR, TOGETHER, APART)


@dataclass(frozen=True)
class MixRule:
    id: str
    kind: str
    count: int
    capability: str | None
    skill_group: str | None
    min_level: int | None
    shift_id: str | None
    workstation_id: str | None
    hard: bool


@dataclass(frozen=True)
class PairRule:
    id: str
    kind: str
    employee_id: str
    partner_id: str
    hard: bool


@dataclass(frozen=True)
class Breach:
    rule_id: str
    kind: str
    hard: bool
    day: str
    text: str


def _hard(raw: dict) -> bool:
    return (raw.get("mode") or "hard") != "soft"


def parse(data: dict) -> tuple[list[MixRule], list[PairRule]]:
    """The rules of a planning input. A malformed rule is left out, not fatal:
    a typo in one rule should not stop a whole plan."""
    mix: list[MixRule] = []
    for i, raw in enumerate(data.get("skill_mix_rules") or []):
        if not isinstance(raw, dict) or raw.get("kind") not in MIX_KINDS:
            continue
        try:
            count = int(raw.get("count"))
        except (TypeError, ValueError):
            continue
        capability = raw.get("capability") or None
        group = raw.get("skill_group") or None
        level = raw.get("min_level")
        level = int(level) if level is not None else None
        if count < 0 or (capability is None and (group is None or level is None)):
            continue
        if raw["kind"] == AT_MOST and capability is None:
            continue
        mix.append(MixRule(
            id=str(raw.get("id") or f"mix-{i}"), kind=raw["kind"], count=count,
            capability=capability, skill_group=group, min_level=level,
            shift_id=raw.get("shift_id") or None, workstation_id=raw.get("workstation_id") or None,
            hard=_hard(raw),
        ))
    pairs: list[PairRule] = []
    for i, raw in enumerate(data.get("pairing_rules") or []):
        if not isinstance(raw, dict) or raw.get("kind") not in PAIR_KINDS:
            continue
        a, b = raw.get("employee_id"), raw.get("partner_id")
        if not a or not b or a == b:
            continue
        pairs.append(PairRule(id=str(raw.get("id") or f"pair-{i}"), kind=raw["kind"], employee_id=a, partner_id=b, hard=_hard(raw)))
    return mix, pairs


def catalog_of(data: dict) -> dict[str, tuple[int, str | None]]:
    """Capability name → (level, skill group), from the input's ``capabilities``."""
    return {
        c["id"]: (int(c.get("level") or 1), c.get("skill_group"))
        for c in data.get("capabilities") or []
        if isinstance(c, dict) and c.get("id")
    }


def counts_toward(rule: MixRule, skills: set[str], catalog: dict[str, tuple[int, str | None]]) -> bool:
    """Whether someone holding ``skills`` counts toward ``rule``."""
    if rule.kind == AT_MOST:
        return rule.capability in skills
    if rule.capability is not None:
        if rule.capability in skills:
            return True
        level, group = catalog.get(rule.capability, (1, None))
        need_group, need_level = group, level
    else:
        need_group, need_level = rule.skill_group, rule.min_level or 1
    if need_group is None:
        return False
    return any(
        catalog.get(s, (1, None))[1] == need_group and catalog.get(s, (1, None))[0] >= need_level
        for s in skills
    )


def applies(rule: MixRule, shift_id: str, workstation_id: str | None) -> bool:
    if rule.shift_id is not None and rule.shift_id != shift_id:
        return False
    return rule.workstation_id is None or rule.workstation_id == workstation_id


def describe(rule: MixRule, shift_name: Callable[[str], str] = str, ws_name: Callable[[str], str] = str) -> str:
    """'at least 1 × nursing level ≥ 3 on Early at ICU'."""
    if rule.capability is not None:
        who = rule.capability + (" (or higher)" if rule.kind == AT_LEAST else "")
    else:
        who = f"{rule.skill_group} level ≥ {rule.min_level}"
    word = "at least" if rule.kind == AT_LEAST else "at most"
    where = []
    if rule.shift_id:
        where.append(f"on {shift_name(rule.shift_id)}")
    if rule.workstation_id:
        where.append(f"at {ws_name(rule.workstation_id)}")
    return f"{word} {rule.count} × {who}" + (" " + " ".join(where) if where else " per shift")


def check(
    mix: list[MixRule],
    pairs: list[PairRule],
    rows: Iterable[tuple[str, str, str, str | None]],
    skills_by_employee: dict[str, set[str]],
    catalog: dict[str, tuple[int, str | None]],
    employee_name: Callable[[str], str] = str,
    shift_name: Callable[[str], str] = str,
    ws_name: Callable[[str], str] = str,
) -> list[Breach]:
    """Every breach of the rules in a plan, given as
    ``(employee_id, day, shift_id, workstation_id)`` rows (``day`` ISO text)."""
    rows = list(rows)
    breaches: list[Breach] = []

    for rule in mix:
        slots: dict[tuple, list[str]] = defaultdict(list)
        for employee_id, day, shift_id, workstation_id in rows:
            if not applies(rule, shift_id, workstation_id):
                continue
            key = (day, shift_id, workstation_id) if rule.workstation_id else (day, shift_id)
            slots[key].append(employee_id)
        for key in sorted(slots):
            people = slots[key]
            matching = sum(1 for e in people if counts_toward(rule, skills_by_employee.get(e, set()), catalog))
            broken = matching < rule.count if rule.kind == AT_LEAST else matching > rule.count
            if not broken:
                continue
            day, shift_id = key[0], key[1]
            place = shift_name(shift_id) + (f" at {ws_name(key[2])}" if len(key) > 2 and key[2] else "")
            breaches.append(Breach(
                rule.id, rule.kind, rule.hard, day,
                f"{day} {place}: {matching} of {describe(rule, shift_name, ws_name)}",
            ))

    cell: dict[tuple[str, str], tuple[str, str | None]] = {
        (employee_id, day): (shift_id, workstation_id) for employee_id, day, shift_id, workstation_id in rows
    }
    days_of: dict[str, list[str]] = defaultdict(list)
    for employee_id, day in cell:
        days_of[employee_id].append(day)
    for rule in pairs:
        a, b = employee_name(rule.employee_id), employee_name(rule.partner_id)
        for day in sorted(days_of.get(rule.employee_id, [])):
            mine = cell[(rule.employee_id, day)]
            theirs = cell.get((rule.partner_id, day))
            if rule.kind == MENTOR and theirs != mine:
                breaches.append(Breach(rule.id, rule.kind, rule.hard, day, f"{day}: {a} works without their mentor {b}"))
            elif rule.kind == TOGETHER and theirs is not None and theirs[0] != mine[0]:
                breaches.append(Breach(rule.id, rule.kind, rule.hard, day, f"{day}: {a} and {b} are on different shifts"))
            elif rule.kind == APART and theirs is not None and theirs[0] == mine[0]:
                breaches.append(Breach(rule.id, rule.kind, rule.hard, day, f"{day}: {a} and {b} are on the same shift"))
    return breaches


def placement_reasons(
    mix: list[MixRule],
    pairs: list[PairRule],
    employee_id: str,
    day: str,
    shift_id: str,
    workstation_id: str | None,
    cell_of: Callable[[str, str], tuple[str, str | None] | None],
    slot_people: Callable[[str, str, str | None], list[str]],
    skills_by_employee: dict[str, set[str]],
    catalog: dict[str, tuple[int, str | None]],
    employee_name: Callable[[str], str] = str,
) -> list[str]:
    """Why placing ``employee_id`` on this slot would break a **hard** rule —
    for a repair or a replacement deciding where someone may go.

    ``cell_of(employee, day)`` is what that person already has that day;
    ``slot_people(day, shift, workstation)`` who is on the slot (all
    workstations when ``workstation`` is None). Only rules a single placement
    can break are checked: a maximum it would exceed, a mentor not there, a
    partner it would separate or join. A minimum is a matter of filling slots,
    which the check of the whole plan reports.
    """
    reasons: list[str] = []
    skills = skills_by_employee.get(employee_id, set())
    for rule in mix:
        if not rule.hard or rule.kind != AT_MOST or not applies(rule, shift_id, workstation_id):
            continue
        if not counts_toward(rule, skills, catalog):
            continue
        others = slot_people(day, shift_id, workstation_id if rule.workstation_id else None)
        already = sum(1 for e in others if e != employee_id and counts_toward(rule, skills_by_employee.get(e, set()), catalog))
        if already + 1 > rule.count:
            reasons.append(f"would be more than {rule.count} × {rule.capability} on that shift")
    for rule in pairs:
        if not rule.hard:
            continue
        if rule.employee_id == employee_id:
            other, partner = rule.partner_id, employee_name(rule.partner_id)
        elif rule.partner_id == employee_id and rule.kind != MENTOR:
            other, partner = rule.employee_id, employee_name(rule.employee_id)
        else:
            continue
        theirs = cell_of(other, day)
        if rule.kind == MENTOR and theirs != (shift_id, workstation_id):
            reasons.append(f"their mentor {partner} is not on that shift")
        elif rule.kind == TOGETHER and theirs is not None and theirs[0] != shift_id:
            reasons.append(f"has to work the same shift as {partner}")
        elif rule.kind == APART and theirs is not None and theirs[0] == shift_id:
            reasons.append(f"may not work the same shift as {partner}")
    return reasons
