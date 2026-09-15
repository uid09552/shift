"""
Shift Planner Optimizer - CP-SAT Solver for Employee Workstation Scheduling.

Builds and solves a constraint programming model that assigns employees to
workstations across shifts and days, respecting skills, availability,
night-shift recovery, minimum rest, and workload balance.

All hard constraints are configurable via the ``constraints`` field in the
input payload.  Setting a numeric constraint to 0 deactivates it entirely.

The model is encapsulated in :class:`ShiftPlanner`; the module-level
:func:`solve` remains the stable entry point used by the CLI, REST API and
NATS handler.
"""

import logging
import time
from datetime import datetime, timedelta

from ortools.sat.python import cp_model

from shift_planner import telemetry
from shift_planner.models import (
    DailyPlanEntry,
    DaySchedule,
    EmployeeDailyPlan,
    PlanningPeriod,
    SchedulingOutput,
    ShiftAssignment,
    ShiftSchedule,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_WEEKDAY_MAP = [
    "monday", "tuesday", "wednesday", "thursday",
    "friday", "saturday", "sunday",
]


def weekday_name(date) -> str:
    """Return lowercase English weekday name for a date (0=monday … 6=sunday)."""
    return _WEEKDAY_MAP[date.weekday()]


def weekday_num(date) -> str:
    """Return numeric weekday string matching input format ('0'=monday … '6'=sunday)."""
    return str(date.weekday())


def parse_date(s):
    """Parse a YYYY-MM-DD string or date object into a date object."""
    from datetime import date as date_class
    if isinstance(s, date_class):
        return s
    return datetime.strptime(s, "%Y-%m-%d").date()


def date_range(start, end):
    """Yield date objects from start to end inclusive."""
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def _parse_time_minutes(t) -> int:
    """Convert a time or string to minutes since midnight."""
    if isinstance(t, str):
        parts = t.split(":")
        return int(parts[0]) * 60 + int(parts[1])
    # datetime.time object
    return t.hour * 60 + t.minute


def _shift_duration_hours(weekday_time: dict) -> float:
    """Calculate the duration in hours of a shift's weekday_time entry."""
    start = _parse_time_minutes(weekday_time["start_time"])
    end = _parse_time_minutes(weekday_time["end_time"])
    if end > start:
        return (end - start) / 60.0
    # Night shift wraps midnight
    return (24 * 60 - start + end) / 60.0


# ---------------------------------------------------------------------------
# Default constraint values (used when ``constraints`` key is absent)
# ---------------------------------------------------------------------------

_DEFAULT_CONSTRAINTS = {
    "night_shift_recovery_days": 2,
    "min_rest_hours": 11.0,
    "max_consecutive_days": 6,
    "max_working_days_per_week": 5,
    "equality_weight": 50000,
    "priority_weights": {"high": 10000, "medium": 1000, "low": 100},
    "shift_continuity_weight": 500,  # Reward for same shift on consecutive days
    "shift_continuity_week_bonus": 2000,  # Bonus for 7+ day streaks on same shift
    "monthly_hours_target_weight": 1000,  # Penalty weight for deviation from monthly hours target
    "weekly_min_hours": None,
    "weekly_max_hours": None,
    "weekly_hours_target_weight": 1000,
    "preference_weight": 300,  # Penalty for violating an employee's preferred_off
    "wish_weight": 20000,  # Reward for fulfilling an employee's shift wish
    "skill_downgrade_weight": 200,  # Penalty for covering a slot with a higher-level skill
    "fatigue_weight": 100,  # Weight on worst-off employee's accumulated fatigue
    "night_shift_fatigue_multiplier": 2.0,
    "min_staffing_mode": "soft",  # or "hard" — see ConstraintConfig
    "keep_fixed_assignments": True,  # False: plan as if employees had no fixed_shifts
    "solver_time_limit_seconds": 120.0,
    "solver_num_workers": 8,
}


_SOLVED = (cp_model.OPTIMAL, cp_model.FEASIBLE)

# Share of solver_time_limit_seconds the coverage phase may use. It usually
# needs a fraction of it: a plan with no shortfall is optimal on sight.
_COVERAGE_TIME_SHARE = 0.5


def _listing(title: str, items: list[str], shown: int = 5) -> str | None:
    """'Title: a; b; c; and 4 more.' — or None for an empty list."""
    if not items:
        return None
    more = len(items) - shown
    text = f"{title}: " + "; ".join(items[:shown])
    return text + (f"; and {more} more." if more > 0 else ".")


def _get_constraints(data: dict) -> dict:
    """Merge user-supplied constraints with defaults."""
    user = data.get("constraints", {})
    merged = dict(_DEFAULT_CONSTRAINTS)
    for k, v in user.items():
        if k in merged and k != "priority_weights":
            merged[k] = v
        elif k == "priority_weights":
            merged["priority_weights"] = {**merged["priority_weights"], **v}
    return merged


# ---------------------------------------------------------------------------
# Planner
# ---------------------------------------------------------------------------


class ShiftPlanner:
    """Object-oriented CP-SAT model builder and solver for one scheduling input.

    Usage: ``ShiftPlanner(data).solve()``.  The lifecycle is linear —
    parse input → create decision variables → add hard constraints → add
    objective terms → run the solver → build the output.  Each step lives in
    its own small method so individual constraints/objectives can be read
    (and changed) in isolation.
    """

    def __init__(self, data: dict):
        self._parse_period(data)
        self._parse_entities(data)
        self._parse_config(data)
        self._load_capability_catalog(data)
        self._build_lookups()

        self.model = cp_model.CpModel()

        # Decision variable: x[e, d, s, w] = 1  ⇔  employee e works at
        # workstation w on day d during shift s.
        self.x: dict = {}
        # Secondary indexes over x, filled during variable creation so the
        # constraint/objective builders can do direct lookups instead of
        # scanning the full (e, d, s, w) cross product every time.
        self.vars_by_emp_day: dict = {}         # (e, d)    -> [vars]
        self.vars_by_emp_day_shift: dict = {}   # (e, d, s) -> [vars]
        self.vars_by_day_shift: dict = {}       # (d, s)    -> [vars]
        self.vars_by_day_shift_ws: dict = {}    # (d, s, w) -> [vars]

        # works[e, d, s] = 1 ⇔ employee works shift s on day d (any
        # workstation). Created lazily and shared between recovery,
        # continuity and streak constraints.
        self._works_cache: dict = {}

        self.obj_terms: list = []
        # Soft-mode staffing shortfalls as (IntVar, priority weight), one per
        # (day, shift[, workstation]) slot with a minimum. Coverage is solved
        # for first, over exactly these — see _solve.
        self.shortfall_vars: list = []
        # Fixed assignments the model can hold: (e_idx, d_idx, s_idx or None
        # for a day off, violation expression, label). Kept first — see _solve.
        self.fixed_terms: list = []
        # Fixed assignments no plan could keep (absent, not qualified, …).
        self.fixed_warnings: list[str] = []

    # ---- Input parsing -----------------------------------------------------

    def _parse_period(self, data: dict) -> None:
        self.start = parse_date(data["planning_period"]["start_date"])
        self.end = parse_date(data["planning_period"]["end_date"])
        self.days = list(date_range(self.start, self.end))
        self.day_index = {day: idx for idx, day in enumerate(self.days)}
        self.day_wd = [weekday_num(day) for day in self.days]
        self.num_days = len(self.days)

    def _parse_entities(self, data: dict) -> None:
        self.employees = data["employees"]
        self.shifts = data["shifts"]
        self.workstations = data["workstations"]
        self.locked_assignments = data.get("locked_assignments") or []
        self.num_emp = len(self.employees)
        self.num_shifts = len(self.shifts)
        self.num_ws = len(self.workstations)
        # Entries of locked_assignments the model has no variable for. Carried
        # to the output rather than raised: a lock that cannot hold is the
        # caller's problem to see, not a reason to return no plan at all.
        self.lock_warnings: list[str] = []

    def _parse_config(self, data: dict) -> None:
        cfg = _get_constraints(data)
        self.cfg = cfg
        self.night_recovery = cfg["night_shift_recovery_days"]
        self.min_rest = cfg["min_rest_hours"]
        self.max_consec = cfg["max_consecutive_days"]
        self.max_weekly = cfg["max_working_days_per_week"]
        self.equality_w = cfg["equality_weight"]
        self.prio_weights = cfg["priority_weights"]
        self.shift_continuity_w = cfg["shift_continuity_weight"]
        self.shift_week_bonus = cfg["shift_continuity_week_bonus"]
        self.monthly_weight = cfg["monthly_hours_target_weight"]
        self.weekly_min_hours_cfg = cfg["weekly_min_hours"]
        self.weekly_max_hours_cfg = cfg["weekly_max_hours"]
        self.weekly_hours_w = cfg["weekly_hours_target_weight"]
        self.preference_w = cfg["preference_weight"]
        self.wish_w = cfg["wish_weight"]
        self.skill_downgrade_w = cfg["skill_downgrade_weight"]
        self.fatigue_w = cfg["fatigue_weight"]
        self.night_fatigue_mult = cfg["night_shift_fatigue_multiplier"]
        self.min_staffing_hard = cfg["min_staffing_mode"] == "hard"
        self.keep_fixed = cfg["keep_fixed_assignments"]
        self.time_limit = cfg["solver_time_limit_seconds"]
        self.num_workers = cfg["solver_num_workers"]
        logger.info("Constraint config: %s", cfg)

    def _build_lookups(self) -> None:
        employees, shifts, workstations = self.employees, self.shifts, self.workstations

        self.emp_unavail = {
            e["id"]: {parse_date(d) for d in e.get("unavailability", [])}
            for e in employees
        }
        self.emp_skills = {e["id"]: set(e["skills"]) for e in employees}
        self.emp_avail_shifts = {e["id"]: set(e["available_shifts"]) for e in employees}
        self.emp_preferred_off = {e["id"]: e.get("preferred_off", []) for e in employees}
        self.emp_wishes = {e["id"]: e.get("wishes", []) for e in employees}
        self.emp_fixed = {e["id"]: e.get("fixed_shifts") or [] for e in employees}

        self.ws_req_skills = {w["id"]: set(w["required_skills"]) for w in workstations}
        self.ws_op_shifts = {w["id"]: set(w["operating_shifts"]) for w in workstations}
        self.ws_priority = {w["id"]: w["priority"] for w in workstations}
        self.ws_min_emp = {w["id"]: w.get("min_employees", 1) for w in workstations}
        self.ws_max_emp = {w["id"]: w.get("max_employees") for w in workstations}
        self.ws_unavail = {
            w["id"]: [
                (parse_date(u["from_date"]), parse_date(u["to_date"]))
                for u in w.get("unavailability", [])
            ]
            for w in workstations
        }
        self.ws_deactivated = {w["id"] for w in workstations if w.get("available", True) is False}

        self.shift_is_night = {s["id"]: s["is_night_shift"] for s in shifts}
        # Per-(shift, weekday) time/staffing configuration, keyed by weekday
        # string. A shift only operates on the weekdays present in its
        # weekday_times list.
        self.shift_wt = {
            (s["id"], wt["weekday"]): wt
            for s in shifts
            for wt in s["weekday_times"]
        }
        self.shift_weekdays = {
            s["id"]: {wt["weekday"] for wt in s["weekday_times"]} for s in shifts
        }

        # Shift durations per (shift index, day index), for the days the shift
        # actually operates on: exact hours (fatigue) and integer tenths of
        # hours (hour-balancing terms).
        self.dur_hours = {
            (s_idx, d_idx): _shift_duration_hours(self.shift_wt[(s["id"], wd)])
            for s_idx, s in enumerate(shifts)
            for d_idx, wd in enumerate(self.day_wd)
            if (s["id"], wd) in self.shift_wt
        }
        self.dur_tenths = {key: int(dur * 10) for key, dur in self.dur_hours.items()}

        # Monthly working-hours targets (tenths of hours, scaled to the planning period)
        self.target_tenths_map = {
            e_idx: int(emp["monthly_working_hours"] * 10 * self.num_days / 30)
            for e_idx, emp in enumerate(employees)
            if emp.get("monthly_working_hours", 0.0) > 0
        }

    def _load_capability_catalog(self, data: dict) -> None:
        """Skill-level catalog (see CapabilityInfo): capabilities without a
        shared skill_group never substitute for one another, so tenants that
        don't set this up see identical behaviour to a plain required-skills
        subset match."""
        catalog = data.get("capabilities", [])
        self.cap_level = {c["id"]: c.get("level", 1) for c in catalog}
        self.cap_group = {c["id"]: c.get("skill_group") for c in catalog}

    # ---- Small per-entity helpers ------------------------------------------

    def _shift_min_emp(self, sid: str, wday: str) -> int:
        return self.shift_wt[(sid, wday)].get("min_employees", 1)

    def _shift_max_emp(self, sid: str, wday: str):
        return self.shift_wt[(sid, wday)].get("max_employees")

    def _shift_recovery_days(self, sid: str, wday: str) -> int:
        """Forced rest days after working this shift on this weekday: explicit
        free_days_after_shift, or night_shift_recovery_days for night shifts
        (whichever is larger)."""
        wt = self.shift_wt[(sid, wday)]
        return max(
            wt.get("free_days_after_shift", 0),
            self.night_recovery if self.shift_is_night[sid] else 0,
        )

    def _ws_unavailable_on(self, wid: str, day) -> bool:
        """Closed that day: deactivated outright, or inside a closure period."""
        if wid in self.ws_deactivated:
            return True
        return any(start <= day <= end for start, end in self.ws_unavail.get(wid, []))

    def _shift_open_somewhere(self, sid: str, day) -> bool:
        """Some workstation runs this shift and is open that day. When none is,
        the shift's own minimum cannot apply."""
        return any(
            sid in self.ws_op_shifts[w["id"]] and not self._ws_unavailable_on(w["id"], day)
            for w in self.workstations
        )

    def _compat_gap_for(self, eid: str, wid: str):
        """Skill compatibility & downgrade gap for one (employee, workstation)
        pair. A pair is compatible if every skill the workstation requires is
        either held directly (gap 0) or covered by a higher-level capability in
        the same skill_group (gap = level difference, penalised via
        skill_downgrade_weight rather than blocked). Requirements with no
        matching skill_group must be held directly. None = incompatible."""
        total_gap = 0
        for req_cap in self.ws_req_skills[wid]:
            if req_cap in self.emp_skills[eid]:
                continue
            req_group = self.cap_group.get(req_cap)
            if req_group is None:
                return None
            req_level = self.cap_level.get(req_cap, 1)
            best_gap = None
            for e_cap in self.emp_skills[eid]:
                if self.cap_group.get(e_cap) != req_group:
                    continue
                e_level = self.cap_level.get(e_cap, 1)
                if e_level >= req_level:
                    gap = e_level - req_level
                    if best_gap is None or gap < best_gap:
                        best_gap = gap
            if best_gap is None:
                return None
            total_gap += best_gap
        return total_gap

    def _works_var(self, e_idx: int, d_idx: int, s_idx: int):
        """Shared BoolVar that is 1 ⇔ the employee works this shift on this
        day (at any workstation), or None when no assignment variable exists
        for the triple. Cached so recovery/continuity/streak constraints reuse
        one variable instead of each creating their own copy."""
        key = (e_idx, d_idx, s_idx)
        if key in self._works_cache:
            return self._works_cache[key]
        shift_vars = self.vars_by_emp_day_shift.get(key)
        if not shift_vars:
            self._works_cache[key] = None
            return None
        works = self.model.NewBoolVar(f"works_{e_idx}_{d_idx}_{s_idx}")
        self.model.Add(sum(shift_vars) == works)
        self._works_cache[key] = works
        return works

    # ---- Decision variables ------------------------------------------------

    def _create_variables(self) -> None:
        # Precompute skill compatibility once per (employee, workstation) pair
        # since it doesn't depend on day/shift.
        self.compat_gap = {}
        for e_idx, emp in enumerate(self.employees):
            for w_idx, ws in enumerate(self.workstations):
                gap = self._compat_gap_for(emp["id"], ws["id"])
                if gap is not None:
                    self.compat_gap[e_idx, w_idx] = gap

        for e_idx, emp in enumerate(self.employees):
            eid = emp["id"]
            for d_idx, day in enumerate(self.days):
                wday = self.day_wd[d_idx]
                if day in self.emp_unavail[eid]:
                    continue
                for s_idx, shift in enumerate(self.shifts):
                    sid = shift["id"]
                    if wday not in self.shift_weekdays[sid]:
                        continue
                    if sid not in self.emp_avail_shifts[eid]:
                        continue
                    for w_idx, ws in enumerate(self.workstations):
                        wid = ws["id"]
                        if sid not in self.ws_op_shifts[wid]:
                            continue
                        if (e_idx, w_idx) not in self.compat_gap:
                            continue
                        if self._ws_unavailable_on(wid, day):
                            continue
                        var = self.model.NewBoolVar(f"x_{e_idx}_{d_idx}_{s_idx}_{w_idx}")
                        self.x[e_idx, d_idx, s_idx, w_idx] = var
                        self.vars_by_emp_day.setdefault((e_idx, d_idx), []).append(var)
                        self.vars_by_emp_day_shift.setdefault((e_idx, d_idx, s_idx), []).append(var)
                        self.vars_by_day_shift.setdefault((d_idx, s_idx), []).append(var)
                        self.vars_by_day_shift_ws.setdefault((d_idx, s_idx, w_idx), []).append(var)

        logger.info(
            "Model has %d decision variables "
            "(search space: %d employees × %d days × %d shifts × %d workstations)",
            len(self.x), self.num_emp, self.num_days, self.num_shifts, self.num_ws,
        )

    # ---- Hard constraints --------------------------------------------------

    def _add_hard_constraints(self) -> None:
        # strong but not blocking (soft mode only — see _require_min_staffing)
        self.min_emp_penalty = max(self.prio_weights.values()) * 20
        self.hard_staffing_count = 0
        self._pin_locked_assignments()
        self._add_fixed_assignments()
        self._limit_one_workstation_per_shift()
        self._limit_workstation_staffing()
        self._limit_one_shift_per_day()
        self._limit_shift_staffing()
        self._add_recovery_days()
        self._limit_weekly_days()
        self._limit_min_rest()
        self._limit_consecutive_days()

    def _pin_locked_assignments(self) -> None:
        """0) Assignments the caller fixed: solve around them, don't re-decide them.

        Each locked row forces its decision variable to 1, which every other
        constraint then has to accommodate — the plan that comes back contains
        the row, or no plan comes back at all. A row with no variable behind it
        (the employee is marked absent that day, lacks the skill, or the
        workstation doesn't run that shift) is impossible by construction: it
        is dropped with a note instead, so one stale lock cannot cost the
        caller the whole solve.
        """
        if not self.locked_assignments:
            return

        emp_idx = {e["id"]: i for i, e in enumerate(self.employees)}
        shift_idx = {s["id"]: i for i, s in enumerate(self.shifts)}
        ws_idx = {w["id"]: i for i, w in enumerate(self.workstations)}

        pinned = 0
        for lock in self.locked_assignments:
            e_idx = emp_idx.get(lock["employee_id"])
            s_idx = shift_idx.get(lock["shift_id"])
            w_idx = ws_idx.get(lock["workstation_id"])
            d_idx = self.day_index.get(parse_date(lock["date"]))
            where = (
                f"{lock['employee_id']} on {lock['date']} "
                f"(shift {lock['shift_id']}, workstation {lock['workstation_id']})"
            )
            if None in (e_idx, s_idx, w_idx, d_idx):
                self.lock_warnings.append(f"{where}: unknown employee, shift, workstation or date")
                continue
            var = self.x.get((e_idx, d_idx, s_idx, w_idx))
            if var is None:
                if self._ws_unavailable_on(lock["workstation_id"], self.days[d_idx]):
                    self.lock_warnings.append(f"{where}: the workstation is closed that day")
                else:
                    self.lock_warnings.append(
                        f"{where}: not a possible assignment (absence, missing skill, "
                        f"or the workstation does not run that shift)"
                    )
                continue
            self.model.Add(var == 1)
            pinned += 1

        logger.info(
            "Locked assignments: %d pinned, %d dropped",
            pinned, len(self.lock_warnings),
        )

    def _add_fixed_assignments(self) -> None:
        """0b) Fixed assignments — rotations, recurring commitments.

        Not hard constraints: a typical rotation (six working days out of
        eight) breaks the weekly day cap somewhere, and one clash must not cost
        the whole plan. Each becomes a violation term instead, which _solve
        minimises before anything else — so every fixed assignment that can be
        kept is kept, and the rest are named in the result.

        With `keep_fixed_assignments` off they are not in the model at all:
        the plan is what the solver would do without any rotation.
        """
        if not self.keep_fixed:
            if any(self.emp_fixed.values()):
                logger.info("Fixed assignments ignored (keep_fixed_assignments=False)")
            return
        shift_index = {s["id"]: i for i, s in enumerate(self.shifts)}
        for e_idx, emp in enumerate(self.employees):
            for fixed in self.emp_fixed.get(emp["id"], []):
                day = parse_date(fixed["date"])
                d_idx = self.day_index.get(day)
                if d_idx is None:
                    continue  # outside the period — not this plan's concern
                sid = fixed.get("shift_id")
                if sid is None:
                    day_vars = self.vars_by_emp_day.get((e_idx, d_idx))
                    if day_vars:  # nothing to keep off when they cannot work anyway
                        label = f"{emp['name']} {day} off"
                        self.fixed_terms.append((e_idx, d_idx, None, sum(day_vars), label))
                    continue
                s_idx = shift_index.get(sid)
                shift_name = self.shifts[s_idx]["name"] if s_idx is not None else sid
                label = f"{emp['name']} {day} {shift_name}"
                works = self._works_var(e_idx, d_idx, s_idx) if s_idx is not None else None
                if works is None:
                    self.fixed_warnings.append(f"{label} ({self._why_not(emp, day, d_idx, sid)})")
                    continue
                self.fixed_terms.append((e_idx, d_idx, s_idx, 1 - works, label))
        if self.fixed_terms or self.fixed_warnings:
            logger.info(
                "Fixed assignments: %d to keep, %d impossible",
                len(self.fixed_terms), len(self.fixed_warnings),
            )

    def _why_not(self, emp: dict, day, d_idx: int, sid: str) -> str:
        """Why no variable exists for this employee on this shift that day."""
        if sid not in self.shift_weekdays:
            return "unknown shift"
        if day in self.emp_unavail[emp["id"]]:
            return "absent that day"
        if sid not in self.emp_avail_shifts[emp["id"]]:
            return "the shift is not among their available shifts"
        if self.day_wd[d_idx] not in self.shift_weekdays[sid]:
            return "the shift does not run on that weekday"
        if not self._shift_open_somewhere(sid, day):
            return "every workstation running that shift is closed"
        return "no workstation running that shift needs their capabilities"

    def _limit_one_workstation_per_shift(self) -> None:
        """1) At most one workstation per (employee, day, shift)."""
        for terms in self.vars_by_emp_day_shift.values():
            self.model.Add(sum(terms) <= 1)

    def _limit_workstation_staffing(self) -> None:
        """2) Minimum and maximum employees per (day, shift, workstation).
        Multiple employees may be assigned to the same workstation+shift,
        bounded by the workstation's configured staffing limits
        (max_employees=None means no explicit cap beyond what other constraints
        allow). The minimum is soft or hard per `min_staffing_mode`; the maximum
        is always hard."""
        for (d_idx, s_idx, w_idx), terms in self.vars_by_day_shift_ws.items():
            wid = self.workstations[w_idx]["id"]
            min_emp = self.ws_min_emp.get(wid, 1)
            max_emp = self.ws_max_emp.get(wid)
            if min_emp > 0:
                self._require_min_staffing(
                    terms, min_emp, f"ws_shortfall_{w_idx}_{d_idx}_{s_idx}",
                    self.prio_weights.get(self.ws_priority[wid], 100),
                )
            if max_emp is not None:
                self.model.Add(sum(terms) <= max_emp)

    def _limit_one_shift_per_day(self) -> None:
        """3) At most one shift per (employee, day) – no double shifts."""
        for terms in self.vars_by_emp_day.values():
            self.model.Add(sum(terms) <= 1)

    def _require_min_staffing(self, terms, min_emp: int, name: str, weight: int) -> None:
        """Enforce `min_emp` over `terms`, the way `min_staffing_mode` asks for.

        Hard: the sum may not fall below the minimum, so a period that cannot be
        staffed comes back infeasible rather than quietly understaffed. Soft
        (the default): a shortfall variable is minimised before anything else
        (see _solve), so the solver fills every slot it can and still returns a
        plan when some cannot be filled. `weight` ranks slots against each other
        when not all of them can be — a high-priority workstation first.
        """
        if self.min_staffing_hard:
            self.model.Add(sum(terms) >= min_emp)
            self.hard_staffing_count += 1
            return
        shortfall = self.model.NewIntVar(0, min_emp, name)
        self.model.Add(shortfall >= min_emp - sum(terms))
        self.shortfall_vars.append((shortfall, weight, min_emp))

    def _limit_shift_staffing(self) -> None:
        """3b) Minimum and maximum employees per (day, shift), summed across all
        workstations operating that shift. The minimum follows
        `min_staffing_mode` (see `_require_min_staffing`); max_employees is
        always a hard constraint."""
        for (d_idx, s_idx), shift_day_terms in self.vars_by_day_shift.items():
            sid = self.shifts[s_idx]["id"]
            wday = self.day_wd[d_idx]
            min_emp = self._shift_min_emp(sid, wday)
            max_emp = self._shift_max_emp(sid, wday)
            if min_emp > 0:
                # A shift's minimum is house-wide, so it ranks with the most
                # important workstation.
                self._require_min_staffing(
                    shift_day_terms, min_emp, f"shortfall_{s_idx}_{d_idx}",
                    max(self.prio_weights.values()),
                )
            if max_emp is not None:
                self.model.Add(sum(shift_day_terms) <= max_emp)

        if self.min_staffing_hard:
            logger.info(
                "Hard staffing minimum: %d mandatory coverage constraints "
                "(a period that cannot be staffed will come back infeasible)",
                self.hard_staffing_count,
            )
        else:
            logger.info(
                "Soft staffing minimum: %d shortfall terms, covered first",
                len(self.shortfall_vars),
            )

    def _add_recovery_days(self) -> None:
        """4) Per-shift forced recovery days (night-shift recovery generalized
        to any shift via free_days_after_shift; 0 recovery days = disabled for
        that shift)."""
        if not any(
            self._shift_recovery_days(sid, wday) > 0 for (sid, wday) in self.shift_wt
        ):
            return

        for (e_idx, d_idx, s_idx) in list(self.vars_by_emp_day_shift):
            sid = self.shifts[s_idx]["id"]
            rec_days = self._shift_recovery_days(sid, self.day_wd[d_idx])
            if rec_days <= 0:
                continue
            works_shift = self._works_var(e_idx, d_idx, s_idx)
            if works_shift is None:
                continue
            for offset in range(1, rec_days + 1):
                rd = d_idx + offset
                if rd >= self.num_days:
                    continue
                for rv in self.vars_by_emp_day.get((e_idx, rd), []):
                    self.model.AddImplication(works_shift, rv.Not())

    def _limit_weekly_days(self) -> None:
        """5) Maximum working days per week (configurable, 0 = disabled)."""
        if self.max_weekly <= 0:
            return
        for e_idx in range(self.num_emp):
            for week_start in range(0, self.num_days, 7):
                terms = [
                    var
                    for d_idx in range(week_start, min(week_start + 7, self.num_days))
                    for var in self.vars_by_emp_day.get((e_idx, d_idx), [])
                ]
                if terms:
                    self.model.Add(sum(terms) <= self.max_weekly)

    def _limit_min_rest(self) -> None:
        """6) Minimum rest between shifts on consecutive days (configurable).

        A shift whose end_time is at or before its start_time runs past
        midnight, so it eats into the following day: its end lies at
        end_time + 24h counted from the day it started. Rest is measured
        between that absolute end and the next day's absolute start, which also
        makes a straight overlap (negative rest) visible. Overlaps are forbidden
        even with min_rest disabled — nobody works two shifts at once.
        """
        # Start/end times are per-weekday, so forbidden shift-to-shift
        # transitions are cached per (weekday1, weekday2) pair rather than
        # computed once globally.
        forbidden_cache: dict = {}

        def _forbidden_transitions(wd1: str, wd2: str):
            key = (wd1, wd2)
            if key in forbidden_cache:
                return forbidden_cache[key]
            pairs = []
            for s1_idx, s1 in enumerate(self.shifts):
                sid1 = s1["id"]
                if (sid1, wd1) not in self.shift_wt:
                    continue
                if self._shift_recovery_days(sid1, wd1) > 0:
                    # Already covered, and more strictly: the next day is off
                    # entirely. Shifts with no forced recovery — including a
                    # night shift when night_shift_recovery_days is 0 — still
                    # need the rest check.
                    continue
                wt1 = self.shift_wt[(sid1, wd1)]
                start1 = _parse_time_minutes(wt1["start_time"])
                end1 = _parse_time_minutes(wt1["end_time"])
                if end1 <= start1:
                    end1 += 24 * 60  # runs into the next day
                for s2_idx, s2 in enumerate(self.shifts):
                    sid2 = s2["id"]
                    if (sid2, wd2) not in self.shift_wt:
                        continue
                    # Day 2 starts 24h after day 1.
                    start2 = 24 * 60 + _parse_time_minutes(
                        self.shift_wt[(sid2, wd2)]["start_time"]
                    )
                    rest_hours = (start2 - end1) / 60.0
                    if rest_hours < self.min_rest or rest_hours < 0:
                        pairs.append((s1_idx, s2_idx))
            forbidden_cache[key] = pairs
            return pairs

        total_forbidden = 0
        for e_idx in range(self.num_emp):
            for d_idx in range(self.num_days - 1):
                wd1 = self.day_wd[d_idx]
                wd2 = self.day_wd[d_idx + 1]
                for s1_idx, s2_idx in _forbidden_transitions(wd1, wd2):
                    late_vars = self.vars_by_emp_day_shift.get((e_idx, d_idx, s1_idx))
                    early_vars = self.vars_by_emp_day_shift.get((e_idx, d_idx + 1, s2_idx))
                    if not late_vars or not early_vars:
                        continue
                    self.model.Add(sum(late_vars) + sum(early_vars) <= 1)
                    total_forbidden += 1

        if total_forbidden:
            logger.info(
                "Added %d forbidden shift-transition constraints "
                "(rest < %.1fh, or the shifts overlap past midnight)",
                total_forbidden, self.min_rest,
            )

    def _limit_consecutive_days(self) -> None:
        """7) Maximum consecutive working days (configurable, 0 = disabled)."""
        if self.max_consec <= 0:
            return
        for e_idx in range(self.num_emp):
            for d_idx in range(self.num_days - self.max_consec):
                window_terms = []
                for d in range(d_idx, d_idx + self.max_consec + 1):
                    day_terms = self.vars_by_emp_day.get((e_idx, d))
                    if not day_terms:
                        break
                    window_terms.extend(day_terms)
                else:
                    self.model.Add(sum(window_terms) <= self.max_consec)

    # ---- Objective (soft constraints) --------------------------------------

    def _add_objective(self) -> None:
        self._penalize_staffing_shortfalls()
        self._reward_coverage()
        self._penalize_skill_downgrades()
        self._compute_employee_hours()
        self._balance_workload()
        self._penalize_monthly_hours_deviation()
        self._penalize_weekly_hours_band()
        self._penalize_preference_violations()
        self._reward_wishes()
        self._penalize_fatigue()
        self._reward_shift_continuity()

    def _penalize_staffing_shortfalls(self) -> None:
        """0) Staffing shortfall penalties (negated because we maximise).

        Coverage is already settled before this objective runs (see _solve);
        the penalty only matters when that first phase stopped short of its
        optimum, and then it keeps pushing the shortfall further down."""
        for shortfall, _weight, _ub in self.shortfall_vars:
            self.obj_terms.append(-self.min_emp_penalty * shortfall)
        # Settled in phase 1 as well; this only keeps pushing if that phase
        # stopped short of its optimum.
        for _e, _d, _s, violation, _label in self.fixed_terms:
            self.obj_terms.append(-self.min_emp_penalty * violation)

    def _reward_coverage(self) -> None:
        """1) Coverage: reward assignments weighted by workstation priority."""
        for (e_idx, d_idx, s_idx, w_idx), var in self.x.items():
            wid = self.workstations[w_idx]["id"]
            weight = self.prio_weights.get(self.ws_priority[wid], 100)
            self.obj_terms.append(weight * var)

    def _penalize_skill_downgrades(self) -> None:
        """1b) Skill downgrade: discourage (but allow) covering a requirement
        with a higher-level capability from the same skill_group instead of an
        exact match."""
        if self.skill_downgrade_w <= 0:
            return
        for (e_idx, d_idx, s_idx, w_idx), var in self.x.items():
            gap = self.compat_gap.get((e_idx, w_idx), 0)
            if gap > 0:
                self.obj_terms.append(-self.skill_downgrade_w * gap * var)

    def _compute_employee_hours(self) -> None:
        """Total working hours per employee (tenths of hours), shared by the
        equality and monthly-hours objectives. Keyed by e_idx (not a plain
        list) so lookups stay aligned even when some employees have no
        feasible hour terms at all."""
        self.emp_hour_totals: dict = {}
        max_tenths = self.num_days * 24 * 10
        per_emp_terms: dict = {e_idx: [] for e_idx in range(self.num_emp)}
        for (e_idx, d_idx, s_idx), shift_vars in self.vars_by_emp_day_shift.items():
            dur = self.dur_tenths[(s_idx, d_idx)]
            per_emp_terms[e_idx].extend(dur * var for var in shift_vars)
        for e_idx, hour_terms in per_emp_terms.items():
            if hour_terms:
                total_h = self.model.NewIntVar(0, max_tenths, f"emp_hours_{e_idx}")
                self.model.Add(total_h == sum(hour_terms))
                self.emp_hour_totals[e_idx] = total_h

    def _balance_workload(self) -> None:
        """2) Equal treatment: minimise spread of working hours across
        employees, with shift-count balance as a secondary criterion."""
        if len(self.emp_hour_totals) < 2 or self.equality_w <= 0:
            return
        max_tenths = self.num_days * 24 * 10
        max_hours = self.model.NewIntVar(0, max_tenths, "max_hours")
        min_hours = self.model.NewIntVar(0, max_tenths, "min_hours")
        self.model.AddMaxEquality(max_hours, list(self.emp_hour_totals.values()))
        self.model.AddMinEquality(min_hours, list(self.emp_hour_totals.values()))
        self.obj_terms.append(-self.equality_w * max_hours)
        self.obj_terms.append(self.equality_w * min_hours)

        # Also balance shift counts as secondary
        emp_shift_totals = []
        for e_idx in range(self.num_emp):
            terms = [
                var
                for d_idx in range(self.num_days)
                for var in self.vars_by_emp_day.get((e_idx, d_idx), [])
            ]
            if terms:
                total = self.model.NewIntVar(0, self.num_days, f"emp_total_{e_idx}")
                self.model.Add(total == sum(terms))
                emp_shift_totals.append(total)

        if len(emp_shift_totals) >= 2:
            max_load = self.model.NewIntVar(0, self.num_days, "max_load")
            min_load = self.model.NewIntVar(0, self.num_days, "min_load")
            self.model.AddMaxEquality(max_load, emp_shift_totals)
            self.model.AddMinEquality(min_load, emp_shift_totals)
            self.obj_terms.append(-100 * max_load)
            self.obj_terms.append(100 * min_load)

    def _penalize_monthly_hours_deviation(self) -> None:
        """3) Monthly hours target: penalise deviation from each employee's
        monthly working hours target."""
        if self.monthly_weight <= 0:
            return
        max_possible = self.num_days * 24 * 10  # tenths of hours
        for e_idx, target_tenths in self.target_tenths_map.items():
            if e_idx not in self.emp_hour_totals:
                continue
            over_dev = self.model.NewIntVar(0, max_possible, f"over_dev_{e_idx}")
            under_dev = self.model.NewIntVar(0, max_possible, f"under_dev_{e_idx}")
            self.model.Add(self.emp_hour_totals[e_idx] - target_tenths == over_dev - under_dev)
            # Penalise deviation from target (symmetric penalty)
            self.obj_terms.append(-self.monthly_weight * over_dev)
            self.obj_terms.append(-self.monthly_weight * under_dev)

    def _penalize_weekly_hours_band(self) -> None:
        """3b) Weekly hour band: soft min/max hours per calendar week (blocks
        of 7 days from the planning period's start), distinct from the monthly
        target above and from the hard max_working_days_per_week day-count
        cap."""
        if self.weekly_hours_w <= 0 or not (self.weekly_min_hours_cfg or self.weekly_max_hours_cfg):
            return
        weekly_min_tenths = int((self.weekly_min_hours_cfg or 0) * 10)
        weekly_max_tenths = int((self.weekly_max_hours_cfg or 24 * 7) * 10)
        for e_idx in range(self.num_emp):
            for week_start in range(0, self.num_days, 7):
                week_end = min(week_start + 7, self.num_days)
                week_terms = [
                    self.dur_tenths[(s_idx, d_idx)] * var
                    for d_idx in range(week_start, week_end)
                    for s_idx in range(self.num_shifts)
                    for var in self.vars_by_emp_day_shift.get((e_idx, d_idx, s_idx), [])
                ]
                if not week_terms:
                    continue
                week_total = self.model.NewIntVar(0, 7 * 24 * 10, f"week_hours_{e_idx}_{week_start}")
                self.model.Add(week_total == sum(week_terms))
                if self.weekly_min_hours_cfg:
                    under = self.model.NewIntVar(0, 7 * 24 * 10, f"week_under_{e_idx}_{week_start}")
                    self.model.Add(under >= weekly_min_tenths - week_total)
                    self.obj_terms.append(-self.weekly_hours_w * under)
                if self.weekly_max_hours_cfg:
                    over = self.model.NewIntVar(0, 7 * 24 * 10, f"week_over_{e_idx}_{week_start}")
                    self.model.Add(over >= week_total - weekly_max_tenths)
                    self.obj_terms.append(-self.weekly_hours_w * over)

    def _penalize_preference_violations(self) -> None:
        """3c) Soft shift/day preferences: employees may mark days (optionally
        a specific shift) they'd rather not work. Unlike `unavailability` this
        never blocks assignment — it only costs `preference_weight` when
        violated."""
        if self.preference_w <= 0:
            return
        for e_idx, emp in enumerate(self.employees):
            for pref in self.emp_preferred_off.get(emp["id"], []):
                pd = parse_date(pref["date"])
                if pd not in self.day_index:
                    continue
                d_idx = self.day_index[pd]
                pref_shift = pref.get("shift_id")
                terms = [
                    var
                    for s_idx, shift in enumerate(self.shifts)
                    if pref_shift is None or shift["id"] == pref_shift
                    for var in self.vars_by_emp_day_shift.get((e_idx, d_idx, s_idx), [])
                ]
                if not terms:
                    continue
                violated = self.model.NewBoolVar(
                    f"pref_violation_{e_idx}_{d_idx}_{pref_shift or 'any'}"
                )
                # Safe as equality: "at most one shift per employee per day"
                # already guarantees sum(terms) is 0 or 1.
                self.model.Add(sum(terms) == violated)
                self.obj_terms.append(-self.preference_w * violated)

    def _reward_wishes(self) -> None:
        """3c-bis) Shift wishes: employees may wish to work a specific shift on
        a specific date. The positive counterpart of preferred_off — fulfilling
        a wish earns `wish_weight`, but the wish never forces the assignment.

        Wishes that no decision variable can satisfy (wrong period, employee not
        available for that shift, no compatible workstation open that day, …)
        are logged rather than silently dropped: an unschedulable wish is the
        usual reason a plan comes back "ignoring" what an employee asked for."""
        if self.wish_w <= 0:
            logger.info("Wish handling disabled (wish_weight=0)")
            return
        shift_index = {shift["id"]: s_idx for s_idx, shift in enumerate(self.shifts)}
        considered = 0
        unschedulable: list[str] = []
        for e_idx, emp in enumerate(self.employees):
            for wish in self.emp_wishes.get(emp["id"], []):
                wd = parse_date(wish["date"])
                sid = wish["shift_id"]

                def _skip(reason: str) -> None:
                    unschedulable.append(f"{emp['name']} {wd} shift {sid}: {reason}")

                if wd not in self.day_index:
                    _skip("date outside the planning period")
                    continue
                d_idx = self.day_index[wd]
                s_idx = shift_index.get(sid)
                if s_idx is None:
                    _skip("unknown shift")
                    continue
                fulfilled = self._works_var(e_idx, d_idx, s_idx)
                if fulfilled is None:
                    if wd in self.emp_unavail[emp["id"]]:
                        _skip("employee is marked unavailable that day")
                    elif sid not in self.emp_avail_shifts[emp["id"]]:
                        _skip("shift is not among the employee's available shifts")
                    elif self.day_wd[d_idx] not in self.shift_weekdays[sid]:
                        _skip("shift does not run on that weekday")
                    elif not self._shift_open_somewhere(sid, wd):
                        _skip("every workstation running that shift is closed that day")
                    else:
                        _skip("no compatible workstation runs that shift that day")
                    continue
                self.obj_terms.append(self.wish_w * fulfilled)
                considered += 1

        logger.info(
            "Shift wishes: %d schedulable (weight %d each), %d unschedulable",
            considered, self.wish_w, len(unschedulable),
        )
        for line in unschedulable:
            logger.warning("Wish cannot be fulfilled — %s", line)

    def _penalize_fatigue(self) -> None:
        """3d) Fatigue-aware objective (ergonomic factor, simplified from the
        paper's half-hour sinusoidal fatigue/rest model): each shift
        contributes a fatigue cost that grows faster than linearly with
        duration and is amplified for night shifts. The solver minimises the
        WORST-OFF employee's accumulated fatigue (minimax), a distinct goal
        from balancing total hours — nobody gets pushed to the brink even if
        hours stay even."""
        if self.fatigue_w <= 0:
            return

        def _shift_fatigue_cost(s_idx: int, d_idx: int) -> int:
            dur = self.dur_hours[(s_idx, d_idx)]
            cost = dur * dur * 10  # tenths of a "fatigue point", quadratic in duration
            if self.shift_is_night[self.shifts[s_idx]["id"]]:
                cost *= self.night_fatigue_mult
            return int(cost)

        fatigue_upper_bound = (
            self.num_days * int(24 * 24 * 10 * max(self.night_fatigue_mult, 1.0)) + 1
        )
        per_emp_terms: dict = {e_idx: [] for e_idx in range(self.num_emp)}
        for (e_idx, d_idx, s_idx), shift_vars in self.vars_by_emp_day_shift.items():
            cost = _shift_fatigue_cost(s_idx, d_idx)
            per_emp_terms[e_idx].extend(cost * var for var in shift_vars)

        emp_fatigue_totals = []
        for e_idx, terms in per_emp_terms.items():
            if terms:
                total_f = self.model.NewIntVar(0, fatigue_upper_bound, f"fatigue_{e_idx}")
                self.model.Add(total_f == sum(terms))
                emp_fatigue_totals.append(total_f)

        if emp_fatigue_totals:
            max_fatigue = self.model.NewIntVar(0, fatigue_upper_bound, "max_fatigue")
            self.model.AddMaxEquality(max_fatigue, emp_fatigue_totals)
            self.obj_terms.append(-self.fatigue_w * max_fatigue)

    def _reward_shift_continuity(self) -> None:
        """4) Shift continuity: reward employees for keeping the same shift
        across consecutive days, with a bonus for 7+ day streaks. Encourages
        assigning the same shift to an employee for at least a week."""
        if self.shift_continuity_w <= 0:
            return
        for e_idx in range(self.num_emp):
            for s_idx in range(self.num_shifts):
                for d_idx in range(self.num_days - 1):
                    works_d = self._works_var(e_idx, d_idx, s_idx)
                    works_next = self._works_var(e_idx, d_idx + 1, s_idx)
                    if works_d is None or works_next is None:
                        continue
                    # continuity_var = 1 ⇔ employee works this shift on both days
                    continuity_var = self.model.NewBoolVar(f"continuity_{e_idx}_{s_idx}_{d_idx}")
                    self.model.AddBoolAnd([works_d, works_next]).OnlyEnforceIf(continuity_var)
                    self.model.AddBoolOr([works_d.Not(), works_next.Not()]).OnlyEnforceIf(
                        continuity_var.Not()
                    )
                    self.obj_terms.append(self.shift_continuity_w * continuity_var)

        # Bonus for week-long streaks (7+ consecutive days on same shift)
        if self.shift_week_bonus <= 0 or self.num_days < 7:
            return
        for e_idx in range(self.num_emp):
            for s_idx in range(self.num_shifts):
                for start_d in range(self.num_days - 6):
                    streak_vars = []
                    for d_offset in range(7):
                        works_day = self._works_var(e_idx, start_d + d_offset, s_idx)
                        if works_day is None:
                            # If any day is not feasible, break the streak
                            streak_vars = []
                            break
                        streak_vars.append(works_day)
                    if len(streak_vars) == 7:
                        week_streak = self.model.NewBoolVar(f"week_streak_{e_idx}_{s_idx}_{start_d}")
                        self.model.AddBoolAnd(streak_vars).OnlyEnforceIf(week_streak)
                        self.model.AddBoolOr([v.Not() for v in streak_vars]).OnlyEnforceIf(
                            week_streak.Not()
                        )
                        self.obj_terms.append(self.shift_week_bonus * week_streak)

    # ---- Solving & output --------------------------------------------------

    def _run_solver(self, time_limit: float, phase: str):
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(time_limit, 1.0)
        solver.parameters.num_workers = self.num_workers
        started = time.perf_counter()
        status = solver.Solve(self.model)
        logger.info(
            "Solver status (%s): %s  (objective=%.0f, %.1fs)",
            phase,
            solver.StatusName(status),
            solver.ObjectiveValue() if status in _SOLVED else 0,
            time.perf_counter() - started,
        )
        return solver, status

    def _solve(self) -> SchedulingOutput:
        """Solve lexicographically: staffing coverage first, everything else second.

        One weighted objective cannot keep coverage on top. Hour balancing,
        fatigue and the hours targets are priced per tenth of an hour, so a
        long shift (a 24h on-call, a night) can cost more there than filling
        its slot earns — and the solver leaves the slot empty. Instead:

        1. Minimise broken fixed assignments, then the priority-weighted
           shortfall against every minimum.
        2. Pin that result (never more shortfall than phase 1 found) and hint
           its plan, then optimise balance, wishes, fatigue, continuity, …

        Hard mode has no shortfall to minimise; without fixed assignments
        either, it goes straight to phase 2.
        """
        started = time.perf_counter()
        fallback = None  # phase-1 plan, if phase 2 finds nothing in time
        coverage_proven = True

        if self.shortfall_vars or self.fixed_terms:
            # Fixed assignments first, then coverage: one broken fixed
            # assignment outweighs the largest shortfall the model allows.
            shortfall = sum(w * v for v, w, _ub in self.shortfall_vars)
            fixed_weight = sum(w * ub for _v, w, ub in self.shortfall_vars) + 1
            broken = sum(violation for *_, violation, _label in self.fixed_terms)
            weighted = fixed_weight * broken + shortfall
            self.model.Minimize(weighted)
            solver, status = self._run_solver(
                self.time_limit * _COVERAGE_TIME_SHARE, "coverage"
            )
            if status == cp_model.INFEASIBLE:
                return self._infeasible_output(self._infeasible_message())
            if status in _SOLVED:
                best = round(solver.ObjectiveValue())
                coverage_proven = status == cp_model.OPTIMAL
                fallback = {key: solver.Value(var) for key, var in self.x.items()}
                # Hint every variable, not just x: the phase-1 solution
                # satisfies the whole model, so the hint is complete and
                # feasible and phase 2 starts from it. A partial hint leaves
                # the solver to rebuild the auxiliaries under a now-tight
                # coverage bound, which on a busy month it may not manage.
                solution = solver.ResponseProto().solution
                self.model.Add(weighted <= best)
                for index, value in enumerate(solution):
                    self.model.AddHint(self.model.get_int_var_from_proto_index(index), value)
            else:
                # No plan at all yet: let phase 2 search without a bound.
                coverage_proven = False

        self.model.Maximize(sum(self.obj_terms))
        remaining = self.time_limit - (time.perf_counter() - started)
        solver, status = self._run_solver(remaining, "objective")

        if status in _SOLVED:
            values = {key: solver.Value(var) for key, var in self.x.items()}
            optimal = status == cp_model.OPTIMAL and coverage_proven
            return self._build_output(values, solver.ObjectiveValue(), optimal)
        if fallback is not None:
            logger.warning("Objective phase found no plan in time — returning the coverage plan")
            return self._build_output(
                fallback, 0.0, False,
                "Only staffing coverage was optimised; balance and wishes "
                "were not (the solver ran out of time).",
            )
        return self._infeasible_output(self._infeasible_message())

    def _infeasible_message(self) -> str:
        # Mandatory minimum staffing is the constraint most likely to have
        # caused this, and the one a planner can act on, so name it.
        hint = (
            " Minimum staffing is set to 'hard', so every shift and "
            "workstation must reach its min_employees — switch it back to "
            "'soft' to allow understaffed slots."
            if self.min_staffing_hard else ""
        )
        if self.locked_assignments:
            hint += (
                f" {len(self.locked_assignments)} assignment(s) were locked; "
                "they are enforced as given, so a set of them that cannot "
                "coexist makes the whole plan infeasible."
            )
        return "No feasible schedule found. Relax constraints or add more employees." + hint

    def _infeasible_output(self, message: str) -> SchedulingOutput:
        return SchedulingOutput(
            status="infeasible",
            planning_period=PlanningPeriod(start_date=self.start, end_date=self.end),
            message=message,
        )

    def _extract_assignments(self, values: dict) -> dict:
        """One pass over the solved decision variables: (e_idx, d_idx) ->
        (s_idx, w_idx). Unique because the model allows at most one shift per
        employee per day."""
        assigned = {}
        for (e_idx, d_idx, s_idx, w_idx), value in values.items():
            if value == 1:
                assigned[(e_idx, d_idx)] = (s_idx, w_idx)
        return assigned

    def _staffing_gaps(self, assigned: dict) -> list[str]:
        """Every slot the plan leaves below its minimum, and why.

        Includes slots the model had no variable for at all — nobody qualified
        and present could take them — which the solver cannot even see as a
        shortfall, so without this they would pass as silently fine."""
        per_slot: dict = {}
        per_shift: dict = {}
        for (e_idx, d_idx), (s_idx, w_idx) in assigned.items():
            per_slot[d_idx, s_idx, w_idx] = per_slot.get((d_idx, s_idx, w_idx), 0) + 1
            per_shift[d_idx, s_idx] = per_shift.get((d_idx, s_idx), 0) + 1

        gaps = []
        for d_idx, day in enumerate(self.days):
            wday = self.day_wd[d_idx]
            for s_idx, shift in enumerate(self.shifts):
                sid = shift["id"]
                if wday not in self.shift_weekdays[sid]:
                    continue
                for w_idx, ws in enumerate(self.workstations):
                    wid = ws["id"]
                    if sid not in self.ws_op_shifts[wid] or self._ws_unavailable_on(wid, day):
                        continue
                    need = self.ws_min_emp.get(wid, 1)
                    have = per_slot.get((d_idx, s_idx, w_idx), 0)
                    if have < need:
                        why = (
                            "not enough staff left" if (d_idx, s_idx, w_idx) in self.vars_by_day_shift_ws
                            else "nobody qualified and available"
                        )
                        gaps.append(f"{day} {shift['name']} @ {ws['name']} {have}/{need} ({why})")
                need = self._shift_min_emp(sid, wday)
                have = per_shift.get((d_idx, s_idx), 0)
                if have < need and self._shift_open_somewhere(sid, day):
                    gaps.append(f"{day} {shift['name']} (all workstations) {have}/{need}")
        return gaps

    def _build_schedule(self, assigned: dict) -> list:
        """Per-day schedule grouped by shift."""
        by_day_shift: dict = {}
        for (e_idx, d_idx), (s_idx, w_idx) in assigned.items():
            by_day_shift.setdefault((d_idx, s_idx), []).append((w_idx, e_idx))

        schedule: list[DaySchedule] = []
        for d_idx, day in enumerate(self.days):
            day_shifts: list[ShiftSchedule] = []
            for s_idx, shift in enumerate(self.shifts):
                pairs = by_day_shift.get((d_idx, s_idx))
                if not pairs:
                    continue
                assignments = [
                    ShiftAssignment(
                        date=day,
                        employee_id=self.employees[e_idx]["id"],
                        employee_name=self.employees[e_idx]["name"],
                        workstation_id=self.workstations[w_idx]["id"],
                        workstation_name=self.workstations[w_idx]["name"],
                    )
                    for w_idx, e_idx in sorted(pairs)
                ]
                day_shifts.append(ShiftSchedule(
                    shift_id=shift["id"],
                    shift_name=shift["name"],
                    assigned_dates=assignments,
                ))
            schedule.append(DaySchedule(
                date=day,
                weekday=weekday_name(day),
                shifts=day_shifts,
            ))
        return schedule

    def _build_employee_plans(self, assigned: dict) -> list:
        """Per-employee daily plan: one DailyPlanEntry per day for every
        employee, covering the full roster so callers always receive a
        complete grid. Each entry is "assigned" (with shift + workstation
        details) or "free" (no shift planned for that day, for any reason)."""
        employee_plans: list[EmployeeDailyPlan] = []
        for e_idx, emp in enumerate(self.employees):
            daily_plan: list[DailyPlanEntry] = []
            for d_idx, day in enumerate(self.days):
                day_str = day.strftime("%Y-%m-%d")
                hit = assigned.get((e_idx, d_idx))
                if hit is None:
                    daily_plan.append(DailyPlanEntry(date=day_str, status="free"))
                    continue
                s_idx, w_idx = hit
                daily_plan.append(DailyPlanEntry(
                    date=day_str,
                    status="assigned",
                    shift_id=self.shifts[s_idx]["id"],
                    shift_name=self.shifts[s_idx]["name"],
                    workstation_id=self.workstations[w_idx]["id"],
                    workstation_name=self.workstations[w_idx]["name"],
                ))
            employee_plans.append(EmployeeDailyPlan(
                employee_id=emp["id"],
                employee_name=emp["name"],
                daily_plan=daily_plan,
            ))
        return employee_plans

    def _build_output(
        self, values: dict, objective: float, optimal: bool, note: str | None = None,
    ) -> SchedulingOutput:
        assigned = self._extract_assignments(values)
        gaps = self._staffing_gaps(assigned)
        if gaps:
            logger.warning("Plan leaves %d slot(s) below minimum staffing", len(gaps))
            for line in gaps:
                logger.warning("Understaffed — %s", line)
        not_kept = self.fixed_warnings + [
            f"{label} (clashes with rest rules or day limits)"
            for e_idx, d_idx, s_idx, _violation, label in self.fixed_terms
            if (assigned.get((e_idx, d_idx)) is not None) != (s_idx is not None)
            or (s_idx is not None and assigned[(e_idx, d_idx)][0] != s_idx)
        ]
        if not_kept:
            logger.warning("Fixed assignments not kept: %d", len(not_kept))
        parts = [
            _listing("Fixed assignment(s) not kept", not_kept),
            _listing("Ignored locked assignment(s)", self.lock_warnings),
            _listing("Below minimum staffing", gaps),
            note,
        ]
        return SchedulingOutput(
            status="optimal" if optimal else "feasible",
            objective_value=objective,
            planning_period=PlanningPeriod(start_date=self.start, end_date=self.end),
            schedule=self._build_schedule(assigned),
            employee_plans=self._build_employee_plans(assigned),
            message=" ".join(p for p in parts if p) or None,
        )

    # ---- Entry point -------------------------------------------------------

    def solve(self) -> SchedulingOutput:
        self._create_variables()
        if not self.x:
            logger.error(
                "No feasible assignment variables created – "
                "check input data and weekday format"
            )
            return self._infeasible_output(
                "No feasible assignments possible. "
                "Check that shift weekdays match the date range and "
                "employees have the required skills."
            )

        self._add_hard_constraints()
        self._add_objective()
        return self._solve()


def solve(data: dict) -> SchedulingOutput:
    """Build and solve the CP-SAT model, return the schedule.

    Stable entry point for the CLI, REST API and NATS handler; the actual
    model lives in :class:`ShiftPlanner`. Being the one entry point, this is
    also where a solve gets traced and measured — see telemetry.record_solve.
    """
    period = data.get("planning_period") or {}
    started = time.perf_counter()

    with telemetry.span(
        "planner.solve",
        **{
            "planner.employees": len(data.get("employees") or []),
            "planner.workstations": len(data.get("workstations") or []),
            "planner.shifts": len(data.get("shifts") or []),
            "planner.period.start": str(period.get("start_date") or ""),
            "planner.period.end": str(period.get("end_date") or ""),
        },
    ) as span:
        result = ShiftPlanner(data).solve()

        duration = time.perf_counter() - started
        telemetry.set_attributes(
            span,
            **{
                "planner.status": result.status,
                "planner.objective_value": float(result.objective_value),
            },
        )
        telemetry.record_solve(duration, result.status)

    return result
