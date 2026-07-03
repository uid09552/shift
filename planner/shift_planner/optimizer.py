"""
Shift Planner Optimizer - CP-SAT Solver for Employee Workstation Scheduling.

Builds and solves a constraint programming model that assigns employees to
workstations across shifts and days, respecting skills, availability,
night-shift recovery, minimum rest, and workload balance.

All hard constraints are configurable via the ``constraints`` field in the
input payload.  Setting a numeric constraint to 0 deactivates it entirely.
"""

import logging
from datetime import datetime, timedelta

from ortools.sat.python import cp_model

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


def _shift_duration_hours(shift: dict) -> float:
    """Calculate the duration of a shift in hours."""
    start = _parse_time_minutes(shift["start_time"])
    end = _parse_time_minutes(shift["end_time"])
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
    "solver_time_limit_seconds": 120.0,
    "solver_num_workers": 8,
}


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
# Solver
# ---------------------------------------------------------------------------


def solve(data: dict) -> dict:
    """Build and solve the CP-SAT model, return the schedule as a dict."""

    # ---- Parse input -------------------------------------------------------
    start = parse_date(data["planning_period"]["start_date"])
    end = parse_date(data["planning_period"]["end_date"])
    days = list(date_range(start, end))

    employees = data["employees"]
    shifts = data["shifts"]
    workstations = data["workstations"]

    num_emp = len(employees)
    num_days = len(days)
    num_shifts = len(shifts)
    num_ws = len(workstations)

    # ---- Constraint configuration ------------------------------------------
    cfg = _get_constraints(data)
    night_recovery = cfg["night_shift_recovery_days"]
    min_rest = cfg["min_rest_hours"]
    max_consec = cfg["max_consecutive_days"]
    max_weekly = cfg["max_working_days_per_week"]
    equality_w = cfg["equality_weight"]
    prio_weights = cfg["priority_weights"]
    shift_continuity_w = cfg["shift_continuity_weight"]
    shift_week_bonus = cfg["shift_continuity_week_bonus"]
    monthly_weight = cfg["monthly_hours_target_weight"]
    time_limit = cfg["solver_time_limit_seconds"]
    num_workers = cfg["solver_num_workers"]

    logger.info("Constraint config: %s", cfg)

    # Lookup tables
    emp_unavail = {
        e["id"]: {parse_date(d) for d in e.get("unavailability", [])}
        for e in employees
    }
    emp_skills = {e["id"]: set(e["skills"]) for e in employees}
    emp_avail_shifts = {e["id"]: set(e["available_shifts"]) for e in employees}

    ws_req_skills = {w["id"]: set(w["required_skills"]) for w in workstations}
    ws_op_shifts = {w["id"]: set(w["operating_shifts"]) for w in workstations}
    ws_priority = {w["id"]: w["priority"] for w in workstations}
    ws_min_emp = {w["id"]: w.get("min_employees", 1) for w in workstations}
    ws_max_emp = {w["id"]: w.get("max_employees") for w in workstations}
    ws_unavail = {
        w["id"]: [
            (parse_date(u["from_date"]), parse_date(u["to_date"]))
            for u in w.get("unavailability", [])
        ]
        for w in workstations
    }

    shift_is_night = {s["id"]: s["is_night_shift"] for s in shifts}
    shift_weekdays = {s["id"]: set(s["weekdays"]) for s in shifts}
    shift_start_min = {s["id"]: _parse_time_minutes(s["start_time"]) for s in shifts}
    shift_end_min = {s["id"]: _parse_time_minutes(s["end_time"]) for s in shifts}
    shift_duration = {s["id"]: _shift_duration_hours(s) for s in shifts}
    shift_min_emp = {s["id"]: s.get("min_employees", 1) for s in shifts}
    shift_max_emp = {s["id"]: s.get("max_employees") for s in shifts}
    # Per-shift forced recovery days: explicit free_days_after_shift, or
    # night_shift_recovery_days for night shifts (whichever is larger).
    shift_recovery_days = {
        s["id"]: max(s.get("free_days_after_shift", 0), night_recovery if s["is_night_shift"] else 0)
        for s in shifts
    }

    # Monthly working-hours targets (tenths of hours, scaled to the planning period)
    target_tenths_map = {
        e_idx: int(emp["monthly_working_hours"] * 10 * num_days / 30)
        for e_idx, emp in enumerate(employees)
        if emp.get("monthly_working_hours", 0.0) > 0
    }

    def _ws_unavailable_on(wid: str, day) -> bool:
        return any(start <= day <= end for start, end in ws_unavail.get(wid, []))

    # ---- Build model -------------------------------------------------------
    model = cp_model.CpModel()

    # Decision variable: x[e, d, s, w] = 1  ⇔  employee e works at
    # workstation w on day d during shift s.
    x = {}
    for e_idx, emp in enumerate(employees):
        eid = emp["id"]
        for d_idx, day in enumerate(days):
            wday = weekday_num(day)
            if day in emp_unavail[eid]:
                continue
            for s_idx, shift in enumerate(shifts):
                sid = shift["id"]
                if wday not in shift_weekdays[sid]:
                    continue
                if sid not in emp_avail_shifts[eid]:
                    continue
                for w_idx, ws in enumerate(workstations):
                    wid = ws["id"]
                    if sid not in ws_op_shifts[wid]:
                        continue
                    if not ws_req_skills[wid].issubset(emp_skills[eid]):
                        continue
                    if _ws_unavailable_on(wid, day):
                        continue
                    x[e_idx, d_idx, s_idx, w_idx] = model.NewBoolVar(
                        f"x_{e_idx}_{d_idx}_{s_idx}_{w_idx}"
                    )

    logger.info(
        "Model has %d decision variables "
        "(search space: %d employees × %d days × %d shifts × %d workstations)",
        len(x), num_emp, num_days, num_shifts, num_ws,
    )

    if not x:
        logger.error(
            "No feasible assignment variables created – "
            "check input data and weekday format"
        )
        return SchedulingOutput(
            status="infeasible",
            planning_period=PlanningPeriod(start_date=start, end_date=end),
            message=(
                "No feasible assignments possible. "
                "Check that shift weekdays match the date range and "
                "employees have the required skills."
            ),
        )

    # ---- Hard constraints --------------------------------------------------

    min_emp_penalty = max(prio_weights.values()) * 20  # strong but not blocking
    staffing_shortfall_terms: list = []

    # 1) At most one workstation per (employee, day, shift)
    for e_idx in range(num_emp):
        for d_idx in range(num_days):
            for s_idx in range(num_shifts):
                terms = [
                    x[e_idx, d_idx, s_idx, w_idx]
                    for w_idx in range(num_ws)
                    if (e_idx, d_idx, s_idx, w_idx) in x
                ]
                if terms:
                    model.Add(sum(terms) <= 1)

    # 2) Minimum (soft) and maximum (hard) employees per (day, shift, workstation).
    # Multiple employees may be assigned to the same workstation+shift, bounded
    # by the workstation's configured staffing limits (max_employees=None means
    # no explicit cap beyond what other constraints allow).
    for d_idx in range(num_days):
        for s_idx in range(num_shifts):
            for w_idx, ws in enumerate(workstations):
                wid = ws["id"]
                terms = [
                    x[e_idx, d_idx, s_idx, w_idx]
                    for e_idx in range(num_emp)
                    if (e_idx, d_idx, s_idx, w_idx) in x
                ]
                if not terms:
                    continue
                min_emp = ws_min_emp.get(wid, 1)
                max_emp = ws_max_emp.get(wid)
                if min_emp > 0:
                    shortfall = model.NewIntVar(0, min_emp, f"ws_shortfall_{w_idx}_{d_idx}_{s_idx}")
                    model.Add(shortfall >= min_emp - sum(terms))
                    staffing_shortfall_terms.append(min_emp_penalty * shortfall)
                if max_emp is not None:
                    model.Add(sum(terms) <= max_emp)

    # 3) At most one shift per (employee, day) – no double shifts
    for e_idx in range(num_emp):
        for d_idx in range(num_days):
            terms = [
                x[e_idx, d_idx, s_idx, w_idx]
                for s_idx in range(num_shifts)
                for w_idx in range(num_ws)
                if (e_idx, d_idx, s_idx, w_idx) in x
            ]
            if terms:
                model.Add(sum(terms) <= 1)

    # 3b) Minimum (soft) and maximum (hard) employees per (day, shift), summed
    # across all workstations operating that shift.
    # min_employees is enforced as a soft penalty so the solver can always find
    # a feasible solution even when not enough eligible employees are available.
    # max_employees remains a hard constraint.
    for d_idx, day in enumerate(days):
        wday = weekday_num(day)
        for s_idx, shift in enumerate(shifts):
            sid = shift["id"]
            if wday not in shift_weekdays[sid]:
                continue
            shift_day_terms = [
                x[e_idx, d_idx, s_idx, w_idx]
                for e_idx in range(num_emp)
                for w_idx in range(num_ws)
                if (e_idx, d_idx, s_idx, w_idx) in x
            ]
            if shift_day_terms:
                min_emp = shift_min_emp[sid]
                max_emp = shift_max_emp[sid]
                if min_emp > 0:
                    # Soft: shortfall = max(0, min_emp - assigned)
                    shortfall = model.NewIntVar(0, min_emp, f"shortfall_{s_idx}_{d_idx}")
                    model.Add(shortfall >= min_emp - sum(shift_day_terms))
                    staffing_shortfall_terms.append(min_emp_penalty * shortfall)
                if max_emp is not None:
                    model.Add(sum(shift_day_terms) <= max_emp)

    logger.info(
        "Soft staffing minimum: %d penalty terms (penalty/slot=%d)",
        len(staffing_shortfall_terms), min_emp_penalty,
    )

    # 4) Per-shift forced recovery days (night-shift recovery generalized to any
    # shift via free_days_after_shift; 0 recovery days = disabled for that shift).
    if any(d > 0 for d in shift_recovery_days.values()):
        for e_idx in range(num_emp):
            for d_idx in range(num_days):
                for s_idx, shift in enumerate(shifts):
                    sid = shift["id"]
                    rec_days = shift_recovery_days[sid]
                    if rec_days <= 0:
                        continue

                    shift_vars = [
                        x[e_idx, d_idx, s_idx, w_idx]
                        for w_idx in range(num_ws)
                        if (e_idx, d_idx, s_idx, w_idx) in x
                    ]
                    if not shift_vars:
                        continue

                    works_shift = model.NewBoolVar(f"works_recov_{e_idx}_{d_idx}_{s_idx}")
                    model.Add(sum(shift_vars) == works_shift)

                    for offset in range(1, rec_days + 1):
                        rd = d_idx + offset
                        if rd >= num_days:
                            continue
                        recovery_vars = [
                            x[e_idx, rd, rs_idx, rw_idx]
                            for rs_idx in range(num_shifts)
                            for rw_idx in range(num_ws)
                            if (e_idx, rd, rs_idx, rw_idx) in x
                        ]
                        for rv in recovery_vars:
                            model.AddImplication(works_shift, rv.Not())

    # 5) Maximum working days per week (configurable, 0 = disabled)
    if max_weekly > 0:
        for e_idx in range(num_emp):
            for week_start_offset in range(0, num_days, 7):
                week_end_offset = min(week_start_offset + 7, num_days)
                terms = [
                    x[e_idx, d_idx, s_idx, w_idx]
                    for d_idx in range(week_start_offset, week_end_offset)
                    for s_idx in range(num_shifts)
                    for w_idx in range(num_ws)
                    if (e_idx, d_idx, s_idx, w_idx) in x
                ]
                if terms:
                    model.Add(sum(terms) <= max_weekly)

    # 6) Minimum rest between shifts on consecutive days (configurable, 0 = disabled)
    if min_rest > 0:
        forbidden_transitions = []
        for s1_idx, s1 in enumerate(shifts):
            if shift_is_night[s1["id"]]:
                continue  # night shifts already handled by recovery constraint
            end1 = shift_end_min[s1["id"]]
            for s2_idx, s2 in enumerate(shifts):
                start2 = shift_start_min[s2["id"]]
                rest_hours = (24 * 60 - end1 + start2) / 60.0
                if rest_hours < min_rest:
                    forbidden_transitions.append((s1_idx, s2_idx))

        if forbidden_transitions:
            logger.info(
                "Adding %d forbidden shift-transition types (rest < %.1fh)",
                len(forbidden_transitions), min_rest,
            )
            for e_idx in range(num_emp):
                for d_idx in range(num_days - 1):
                    for s1_idx, s2_idx in forbidden_transitions:
                        late_vars = [
                            x[e_idx, d_idx, s1_idx, w_idx]
                            for w_idx in range(num_ws)
                            if (e_idx, d_idx, s1_idx, w_idx) in x
                        ]
                        early_vars = [
                            x[e_idx, d_idx + 1, s2_idx, w_idx]
                            for w_idx in range(num_ws)
                            if (e_idx, d_idx + 1, s2_idx, w_idx) in x
                        ]
                        if not late_vars or not early_vars:
                            continue
                        model.Add(sum(late_vars) + sum(early_vars) <= 1)

    # 7) Maximum consecutive working days (configurable, 0 = disabled)
    if max_consec > 0:
        for e_idx in range(num_emp):
            for d_idx in range(num_days - max_consec):
                window_terms = []
                for d in range(d_idx, d_idx + max_consec + 1):
                    day_terms = [
                        x[e_idx, d, s_idx, w_idx]
                        for s_idx in range(num_shifts)
                        for w_idx in range(num_ws)
                        if (e_idx, d, s_idx, w_idx) in x
                    ]
                    if not day_terms:
                        break
                    window_terms.extend(day_terms)
                else:
                    model.Add(sum(window_terms) <= max_consec)

    # ---- Objective (soft constraints) --------------------------------------

    obj_terms = []

    # 0) Staffing shortfall penalties (negated because we maximise)
    for term in staffing_shortfall_terms:
        obj_terms.append(-term)

    # 1) Coverage: reward assignments weighted by workstation priority
    for key, var in x.items():
        e_idx, d_idx, s_idx, w_idx = key
        wid = workstations[w_idx]["id"]
        p = ws_priority[wid]
        weight = prio_weights.get(p, 100)
        obj_terms.append(weight * var)

    # 2) Equal treatment: minimise spread of working hours across employees
    # Keyed by e_idx (not a plain list) so lookups below stay aligned even when
    # some employees have no feasible hour terms at all.
    emp_hour_totals: dict = {}
    for e_idx in range(num_emp):
        hour_terms = []
        for d_idx in range(num_days):
            for s_idx, shift in enumerate(shifts):
                dur = int(shift_duration[shift["id"]] * 10)  # tenths of hours
                for w_idx in range(num_ws):
                    key = (e_idx, d_idx, s_idx, w_idx)
                    if key in x:
                        hour_terms.append(dur * x[key])
        if hour_terms:
            total_h = model.NewIntVar(0, num_days * 24 * 10, f"emp_hours_{e_idx}")
            model.Add(total_h == sum(hour_terms))
            emp_hour_totals[e_idx] = total_h

    if len(emp_hour_totals) >= 2 and equality_w > 0:
        max_hours = model.NewIntVar(0, num_days * 24 * 10, "max_hours")
        min_hours = model.NewIntVar(0, num_days * 24 * 10, "min_hours")
        model.AddMaxEquality(max_hours, list(emp_hour_totals.values()))
        model.AddMinEquality(min_hours, list(emp_hour_totals.values()))

        obj_terms.append(-equality_w * max_hours)
        obj_terms.append(equality_w * min_hours)

        # Also balance shift counts as secondary
        emp_shift_totals = []
        for e_idx in range(num_emp):
            terms = [
                x[e_idx, d_idx, s_idx, w_idx]
                for d_idx in range(num_days)
                for s_idx in range(num_shifts)
                for w_idx in range(num_ws)
                if (e_idx, d_idx, s_idx, w_idx) in x
            ]
            if terms:
                total = model.NewIntVar(0, num_days, f"emp_total_{e_idx}")
                model.Add(total == sum(terms))
                emp_shift_totals.append(total)

        if len(emp_shift_totals) >= 2:
            max_load = model.NewIntVar(0, num_days, "max_load")
            min_load = model.NewIntVar(0, num_days, "min_load")
            model.AddMaxEquality(max_load, emp_shift_totals)
            model.AddMinEquality(min_load, emp_shift_totals)
            obj_terms.append(-100 * max_load)
            obj_terms.append(100 * min_load)

    # 3) Monthly hours target: penalise deviation from each employee's monthly working hours target
    if monthly_weight > 0:
        max_possible = num_days * 24 * 10  # tenths of hours
        for e_idx, target_tenths in target_tenths_map.items():
            if e_idx in emp_hour_totals:
                over_dev = model.NewIntVar(0, max_possible, f"over_dev_{e_idx}")
                under_dev = model.NewIntVar(0, max_possible, f"under_dev_{e_idx}")
                model.Add(emp_hour_totals[e_idx] - target_tenths == over_dev - under_dev)
                # Penalise deviation from target (symmetric penalty)
                obj_terms.append(-monthly_weight * over_dev)
                obj_terms.append(-monthly_weight * under_dev)

    # 4) Shift continuity: reward employees for keeping the same shift across consecutive days
    # This encourages the optimizer to assign the same shift to an employee for at least a week
    if shift_continuity_w > 0:
        # For each employee, create variables tracking if they work the same shift on consecutive days
        for e_idx in range(num_emp):
            for s_idx in range(num_shifts):
                # Track consecutive days on the same shift
                for d_idx in range(num_days - 1):
                    # Get all workstation assignments for this employee on this shift for day d and d+1
                    day_d_vars = [
                        x[e_idx, d_idx, s_idx, w_idx]
                        for w_idx in range(num_ws)
                        if (e_idx, d_idx, s_idx, w_idx) in x
                    ]
                    day_next_vars = [
                        x[e_idx, d_idx + 1, s_idx, w_idx]
                        for w_idx in range(num_ws)
                        if (e_idx, d_idx + 1, s_idx, w_idx) in x
                    ]
                    
                    if day_d_vars and day_next_vars:
                        # works_shift_d = 1 if employee works this shift on day d
                        works_shift_d = model.NewBoolVar(f"works_shift_{e_idx}_{s_idx}_{d_idx}")
                        model.Add(sum(day_d_vars) == works_shift_d)
                        
                        # works_shift_next = 1 if employee works this shift on day d+1
                        works_shift_next = model.NewBoolVar(f"works_shift_{e_idx}_{s_idx}_{d_idx + 1}")
                        model.Add(sum(day_next_vars) == works_shift_next)
                        
                        # continuity_var = 1 if employee works same shift on both days
                        continuity_var = model.NewBoolVar(f"continuity_{e_idx}_{s_idx}_{d_idx}")
                        model.AddBoolAnd([works_shift_d, works_shift_next]).OnlyEnforceIf(continuity_var)
                        model.AddBoolOr([works_shift_d.Not(), works_shift_next.Not()]).OnlyEnforceIf(continuity_var.Not())
                        
                        # Reward continuity
                        obj_terms.append(shift_continuity_w * continuity_var)
        
        # Bonus for week-long streaks (7+ consecutive days on same shift)
        if shift_week_bonus > 0 and num_days >= 7:
            for e_idx in range(num_emp):
                for s_idx in range(num_shifts):
                    # Check for 7-day streaks
                    for start_d in range(num_days - 6):
                        # Create a variable that is 1 if employee works shift s for all 7 days starting at start_d
                        streak_vars = []
                        for d_offset in range(7):
                            d_idx = start_d + d_offset
                            day_vars = [
                                x[e_idx, d_idx, s_idx, w_idx]
                                for w_idx in range(num_ws)
                                if (e_idx, d_idx, s_idx, w_idx) in x
                            ]
                            if day_vars:
                                works_day = model.NewBoolVar(f"works_day_{e_idx}_{s_idx}_{d_idx}")
                                model.Add(sum(day_vars) == works_day)
                                streak_vars.append(works_day)
                            else:
                                # If any day is not feasible, break the streak
                                streak_vars = []
                                break
                        
                        if len(streak_vars) == 7:
                            week_streak = model.NewBoolVar(f"week_streak_{e_idx}_{s_idx}_{start_d}")
                            model.AddBoolAnd(streak_vars).OnlyEnforceIf(week_streak)
                            model.AddBoolOr([v.Not() for v in streak_vars]).OnlyEnforceIf(week_streak.Not())
                            obj_terms.append(shift_week_bonus * week_streak)

    model.Maximize(sum(obj_terms))

    # ---- Solve -------------------------------------------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = num_workers
    status = solver.Solve(model)

    logger.info(
        "Solver status: %s  (objective=%.0f)",
        solver.StatusName(status),
        solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0,
    )

    # ---- Build output ------------------------------------------------------
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SchedulingOutput(
            status="infeasible",
            planning_period=PlanningPeriod(start_date=start, end_date=end),
            message=(
                "No feasible schedule found. "
                "Relax constraints or add more employees."
            ),
        )

    period = PlanningPeriod(
        start_date=start,
        end_date=end,
    )

    # Per-day schedule grouped by shift
    schedule: list[DaySchedule] = []
    for d_idx, day in enumerate(days):
        wday = weekday_num(day)
        day_shifts: list[ShiftSchedule] = []
        for s_idx, shift in enumerate(shifts):
            if wday not in shift_weekdays[shift["id"]]:
                continue
            assignments: list[ShiftAssignment] = []
            for w_idx, ws in enumerate(workstations):
                if shift["id"] not in ws_op_shifts[ws["id"]]:
                    continue
                for e_idx, emp in enumerate(employees):
                    key = (e_idx, d_idx, s_idx, w_idx)
                    if key in x and solver.Value(x[key]) == 1:
                        assignments.append(ShiftAssignment(
                            date=day,
                            employee_id=emp["id"],
                            employee_name=emp["name"],
                            workstation_id=ws["id"],
                            workstation_name=ws["name"],
                        ))
            if assignments:
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

    # Determine which (employee, day) slots are forced "free" days: either a
    # mandatory rest day after a shift with recovery days, or a day left open
    # because the employee already reached their monthly hours target.
    assigned_shift_for: dict = {}  # (e_idx, d_idx) -> shift_id
    for e_idx in range(num_emp):
        for d_idx in range(num_days):
            for s_idx, shift in enumerate(shifts):
                for w_idx in range(num_ws):
                    key = (e_idx, d_idx, s_idx, w_idx)
                    if key in x and solver.Value(x[key]) == 1:
                        assigned_shift_for[(e_idx, d_idx)] = shift["id"]
                        break
                else:
                    continue
                break

    forced_free_days: set = set()
    for (e_idx, d_idx), sid in assigned_shift_for.items():
        rec_days = shift_recovery_days.get(sid, 0)
        for offset in range(1, rec_days + 1):
            rd = d_idx + offset
            if rd < num_days:
                forced_free_days.add((e_idx, rd))

    emp_met_target = {
        e_idx
        for e_idx, total_var in emp_hour_totals.items()
        if e_idx in target_tenths_map and solver.Value(total_var) >= target_tenths_map[e_idx]
    }

    # Per-employee daily plan: one DailyPlanEntry per day for every employee.
    # Each entry is "assigned" (with shift + workstation details), "free"
    # (mandatory rest, or contracted monthly hours already met), or
    # "not_assigned" so callers always receive a complete grid.
    employee_plans: list[EmployeeDailyPlan] = []
    for e_idx, emp in enumerate(employees):
        daily_plan: list[DailyPlanEntry] = []

        for d_idx, day in enumerate(days):
            day_str = day.strftime("%Y-%m-%d")
            found = False

            for s_idx, shift in enumerate(shifts):
                if found:
                    break
                sid = shift["id"]
                for w_idx in range(num_ws):
                    key = (e_idx, d_idx, s_idx, w_idx)
                    if key in x and solver.Value(x[key]) == 1:
                        daily_plan.append(DailyPlanEntry(
                            date=day_str,
                            status="assigned",
                            shift_id=sid,
                            shift_name=shift["name"],
                            workstation_id=workstations[w_idx]["id"],
                            workstation_name=workstations[w_idx]["name"],
                        ))
                        found = True
                        break

            if not found:
                is_free = (e_idx, d_idx) in forced_free_days or e_idx in emp_met_target
                daily_plan.append(DailyPlanEntry(
                    date=day_str,
                    status="free" if is_free else "not_assigned",
                ))

        employee_plans.append(EmployeeDailyPlan(
            employee_id=emp["id"],
            employee_name=emp["name"],
            daily_plan=daily_plan,
        ))

    return SchedulingOutput(
        status="optimal" if status == cp_model.OPTIMAL else "feasible",
        objective_value=solver.ObjectiveValue(),
        planning_period=period,
        schedule=schedule,
        employee_plans=employee_plans,
    )
