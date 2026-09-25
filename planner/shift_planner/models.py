"""
Data models for shift planning with validation using Pydantic.
"""

from datetime import date, time
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------

class PlanningPeriod(BaseModel):
    """Planning period with start and end dates."""

    start_date: date
    end_date: date

    @field_validator("end_date")
    @classmethod
    def end_after_start(cls, v, info):
        """Validate that end_date is after start_date."""
        if "start_date" in info.data and v < info.data["start_date"]:
            raise ValueError("end_date must be after start_date")
        return v


class ShiftWeekdayTime(BaseModel):
    """Time and staffing configuration for a shift on one specific weekday."""

    weekday: str
    start_time: time
    end_time: time
    min_employees: int = Field(default=1, ge=0)
    max_employees: Optional[int] = Field(default=None, ge=0)
    # Number of consecutive days an employee must be kept free/rest after
    # working this shift on this weekday (0-5, 0 = no forced recovery days).
    free_days_after_shift: int = Field(default=0, ge=0, le=5)

    @field_validator("weekday")
    @classmethod
    def valid_weekday(cls, v):
        """Validate that weekday is a valid day number."""
        valid_days = {"0", "1", "2", "3", "4", "5", "6"}
        if v not in valid_days:
            raise ValueError(f"Invalid weekday: {v}. Must be one of {valid_days}")
        return v


class Shift(BaseModel):
    """Shift definition with per-weekday time and staffing configuration."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    is_night_shift: bool = False
    weekday_times: List[ShiftWeekdayTime] = Field(..., min_length=1)

    @field_validator("weekday_times")
    @classmethod
    def unique_weekdays(cls, v):
        """Validate that each weekday appears at most once."""
        weekdays = [wt.weekday for wt in v]
        if len(weekdays) != len(set(weekdays)):
            raise ValueError("Duplicate weekday entries found in weekday_times")
        return v


class WorkstationUnavailabilityRange(BaseModel):
    """A date range during which a workstation cannot be staffed."""

    from_date: date
    to_date: date

    @field_validator("to_date")
    @classmethod
    def to_after_from(cls, v, info):
        """Validate that to_date is not before from_date."""
        if "from_date" in info.data and v < info.data["from_date"]:
            raise ValueError("to_date must be after from_date")
        return v


class Workstation(BaseModel):
    """Workstation definition with skills and priority."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    required_skills: List[str] = Field(default_factory=list)
    priority: str = Field(default="medium")
    operating_shifts: List[str] = Field(..., min_length=1)
    # Staffing limits: how many employees may work at this workstation per
    # shift per day. min_employees is enforced as a soft constraint, max_employees
    # is hard (None = unlimited).
    min_employees: int = Field(default=1, ge=0)
    max_employees: Optional[int] = Field(default=None, ge=0)
    # Periods during which this workstation cannot be staffed (e.g. maintenance).
    unavailability: List[WorkstationUnavailabilityRange] = Field(default_factory=list)
    # False = deactivated: closed on every day, as if one period covered the
    # whole plan. The backend leaves such workstations out of its payload; the
    # flag is for callers that send them anyway.
    available: bool = True

    @field_validator("priority")
    @classmethod
    def valid_priority(cls, v):
        """Validate priority is one of the allowed values."""
        valid_priorities = {"low", "medium", "high"}
        if v not in valid_priorities:
            raise ValueError(
                f"Invalid priority: {v}. Must be one of {valid_priorities}"
            )
        return v


class PreferredOff(BaseModel):
    """A day (optionally one specific shift) an employee would rather not work.

    Unlike `unavailability`, this is a soft signal: the solver may still assign
    the employee here under pressure, at a penalty (`preference_weight`).
    """

    date: date
    shift_id: Optional[str] = None


class ShiftWish(BaseModel):
    """A shift the employee wishes to work on a specific date.

    The positive counterpart of `PreferredOff`: a soft signal that rewards the
    solver (`wish_weight`) for assigning the employee this shift on this date.
    It never forces the assignment.
    """

    date: date
    shift_id: str = Field(..., min_length=1)


class FixedShift(BaseModel):
    """A fixed assignment: work this shift on this day — or, with no shift,
    be off. Rotation patterns write these. The solver keeps them ahead of
    every other goal and reports any it cannot; it never fails because of them."""

    date: date
    shift_id: Optional[str] = None


class Employee(BaseModel):
    """Employee definition with skills and availability."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    skills: List[str] = Field(default_factory=list)
    available_shifts: List[str] = Field(default_factory=list)
    unavailability: List[date] = Field(default_factory=list)
    monthly_working_hours: float = Field(default=0.0, ge=0)
    preferred_off: List[PreferredOff] = Field(default_factory=list)
    wishes: List[ShiftWish] = Field(default_factory=list)
    fixed_shifts: List[FixedShift] = Field(default_factory=list)
    # Personal limits. Nights and weekends count per calendar month and follow
    # constraints.personal_limits_mode; no_night_shifts is always hard;
    # preferred_days_off ("0" = Monday … "6" = Sunday) costs preference_weight
    # per day worked, like preferred_off.
    max_nights_per_month: Optional[int] = Field(default=None, ge=0, le=31)
    max_weekends_per_month: Optional[int] = Field(default=None, ge=0, le=5)
    no_night_shifts: bool = False
    preferred_days_off: List[str] = Field(default_factory=list)


class LockedAssignment(BaseModel):
    """An assignment the solver must keep exactly as given.

    Re-solving a plan that a planner has already worked on would otherwise
    throw their decisions away. Locking the rows worth keeping turns a fresh
    solve into a repair: the model is handed those assignments as facts and
    only fills in the rest. An entry the model cannot represent (the employee
    is absent that day, the workstation does not run that shift) is reported
    in the result's ``message`` rather than making the whole solve infeasible.
    """

    employee_id: str = Field(..., min_length=1)
    date: date
    shift_id: str = Field(..., min_length=1)
    workstation_id: str = Field(..., min_length=1)


class HistoryShift(BaseModel):
    """A shift someone already worked in the days before the period.

    Read-only: the solver never plans these days, it only carries their
    consequences across the period start — the recovery days owed after a
    night on the last day, the rest before the first morning, and a streak of
    working days that is already running. Rows on or after the period start
    are ignored.
    """

    employee_id: str = Field(..., min_length=1)
    date: date
    shift_id: str = Field(..., min_length=1)


class CapabilityInfo(BaseModel):
    """Capability catalog entry carrying skill-level metadata.

    Powers the skill-downgrade objective: capabilities that share a
    `skill_group` are treated as substitutable tiers of the same skill (e.g.
    "Registered Nurse" level 3, "Practical Nurse" level 2, "Assistant Nurse"
    level 1 all in group "nursing"). A higher-level capability may cover a
    lower-level requirement in the same group at a penalty; capabilities
    without a shared group never substitute for one another, so tenants that
    don't set `skill_group` see no change from a plain requires-this-exact-tag
    match.
    """

    id: str = Field(..., min_length=1)
    level: int = Field(default=1, ge=1)
    skill_group: Optional[str] = None


class ConstraintConfig(BaseModel):
    """Configurable constraints for the scheduler.

    All fields are optional. When omitted the solver uses sensible defaults.
    Set a numeric constraint to 0 to deactivate it entirely.
    """

    # Night-shift recovery: number of days off after a night shift (0 = disabled)
    night_shift_recovery_days: int = Field(default=2, ge=0, le=7)

    # Minimum rest hours between shifts on consecutive days (0 = disabled)
    min_rest_hours: float = Field(default=11.0, ge=0, le=24)

    # Maximum consecutive working days (0 = disabled)
    max_consecutive_days: int = Field(default=6, ge=0, le=14)

    # Maximum working days per calendar week (0 = disabled)
    max_working_days_per_week: int = Field(default=5, ge=0, le=7)

    # Weight for the equal-treatment (working-hours balance) objective.
    # Higher values make the solver prioritise fairness over coverage.
    equality_weight: int = Field(default=50000, ge=0)

    # Priority weights for workstation coverage (high / medium / low)
    priority_weights: Dict[str, int] = Field(
        default_factory=lambda: {"high": 10000, "medium": 1000, "low": 100}
    )

    # Reward per consecutive-day pair where an employee keeps the same shift.
    # Higher values encourage the solver to avoid switching shifts mid-week.
    shift_continuity_weight: int = Field(default=500, ge=0)

    # Bonus added on top of continuity reward when the same shift runs for 7+
    # consecutive days.  Encourages week-long shift stability.
    shift_continuity_week_bonus: int = Field(default=2000, ge=0)

    # Weight for penalizing deviation from each employee's monthly working hours target.
    # Higher values make the solver try harder to hit each employee's target hours.
    # Enabled by default so employees' monthly_working_hours targets are respected;
    # set to 0 to disable.
    monthly_hours_target_weight: int = Field(default=1000, ge=0)

    # Soft weekly working-hours band, distinct from the monthly target above and
    # from the hard max_working_days_per_week day-count cap. None/0 = disabled.
    weekly_min_hours: Optional[float] = Field(default=None, ge=0)
    weekly_max_hours: Optional[float] = Field(default=None, ge=0)
    weekly_hours_target_weight: int = Field(default=1000, ge=0)

    # Penalty for assigning an employee to a day/shift they marked as
    # `preferred_off` on their profile. Soft — never blocks the assignment.
    preference_weight: int = Field(default=300, ge=0)

    # Reward for fulfilling an employee's shift wish (see Employee.wishes).
    # Soft — never forces the assignment. 0 disables wish handling.
    # Deliberately large relative to coverage (priority_weights) so a wish is
    # not drowned out by the ordinary value of an assignment: at the default it
    # is worth 2x a high-priority coverage slot, but still less than leaving a
    # workstation understaffed or than a full hour of unfairness
    # (equality_weight). Raise it towards equality_weight to make wishes
    # near-mandatory.
    wish_weight: int = Field(default=20000, ge=0)

    # Penalty for covering a workstation's required skill with a higher-level
    # capability from the same skill_group instead of the exact match (see
    # CapabilityInfo). 0 disables skill-downgrade tracking entirely.
    skill_downgrade_weight: int = Field(default=200, ge=0)

    # Fatigue-aware scheduling (ergonomic factor). Each shift contributes a
    # fatigue cost that grows faster than linearly with duration; night shifts
    # are amplified by night_shift_fatigue_multiplier. The solver minimises the
    # worst-off employee's accumulated fatigue (minimax), which is a distinct
    # goal from balancing total hours. 0 disables fatigue tracking.
    fatigue_weight: int = Field(default=100, ge=0)
    night_shift_fatigue_multiplier: float = Field(default=2.0, ge=1.0)

    # How `min_employees` (per shift/day and per workstation/shift/day) is
    # enforced. "soft" penalises a shortfall so a plan always exists; "hard"
    # forbids one, which is what a tenant wants when a station legally cannot
    # run understaffed — at the price of an infeasible answer when there are
    # not enough eligible employees.
    min_staffing_mode: Literal["soft", "hard"] = "soft"

    # Whether employees' `fixed_shifts` (what rotation patterns write) are
    # kept — ahead of coverage and every other goal — or ignored, so the plan
    # is what the solver would do without them.
    keep_fixed_assignments: bool = True
    # "hard": an employee's max_nights_per_month / max_weekends_per_month are
    # never exceeded (a slot stays empty instead). "soft": exceeded only to fill
    # a slot that would otherwise stay empty — as little as possible, ahead of
    # every other goal — and named in `message`.
    personal_limits_mode: Literal["soft", "hard"] = "hard"

    # Solver time limit in seconds
    solver_time_limit_seconds: float = Field(default=120.0, gt=0)

    # Number of parallel solver workers
    solver_num_workers: int = Field(default=8, ge=1, le=64)


class SchedulingInput(BaseModel):
    """Root model for scheduling input data."""

    planning_period: PlanningPeriod
    shifts: List[Shift] = Field(..., min_length=1)
    workstations: List[Workstation] = Field(..., min_length=1)
    employees: List[Employee] = Field(..., min_length=1)
    capabilities: List[CapabilityInfo] = Field(default_factory=list)
    # Assignments the solver may not change. Everything else is solved around
    # them — see LockedAssignment.
    locked_assignments: List[LockedAssignment] = Field(default_factory=list)
    # The confirmed roster just before the period — see HistoryShift.
    history: List[HistoryShift] = Field(default_factory=list)
    constraints: ConstraintConfig = Field(default_factory=ConstraintConfig)

    @field_validator("shifts", "workstations", "employees")
    @classmethod
    def unique_ids(cls, v):
        """Validate that all IDs are unique within their list."""
        ids = [item.id for item in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate IDs found")
        return v


# ---------------------------------------------------------------------------
# Output models
# ---------------------------------------------------------------------------

class ShiftAssignment(BaseModel):
    """A single assignment within a shift on a specific date."""

    date: date
    employee_id: str
    employee_name: str
    workstation_id: str
    workstation_name: str


class ShiftSchedule(BaseModel):
    """Schedule for a specific shift across the planning period."""

    shift_id: str
    shift_name: str
    assigned_dates: List[ShiftAssignment] = Field(default_factory=list)


class DaySchedule(BaseModel):
    """Schedule for a single day, broken down by shift."""

    date: date
    weekday: str
    shifts: List[ShiftSchedule] = Field(default_factory=list)


class DailyPlanEntry(BaseModel):
    """One entry per day in the planning period for a given employee."""

    date: str
    status: str  # "assigned" or "free" (no shift planned for this day)
    shift_id: Optional[str] = None
    shift_name: Optional[str] = None
    workstation_id: Optional[str] = None
    workstation_name: Optional[str] = None


class EmployeeDailyPlan(BaseModel):
    """Per-employee daily plan covering every day in the planning period."""

    employee_id: str
    employee_name: str
    daily_plan: List[DailyPlanEntry] = Field(default_factory=list)


class SchedulingOutput(BaseModel):
    """Root model for scheduling output data."""

    status: str
    objective_value: float = 0.0
    planning_period: PlanningPeriod
    schedule: List[DaySchedule] = Field(default_factory=list)
    employee_plans: List[EmployeeDailyPlan] = Field(default_factory=list)
    message: Optional[str] = None


# ---------------------------------------------------------------------------
# Load helpers
# ---------------------------------------------------------------------------

def load_and_validate(path: str) -> SchedulingInput:
    """Load and validate scheduling input from JSON file."""
    import json

    with open(path, "r") as fh:
        data = json.load(fh)

    if not isinstance(data, dict):
        raise ValueError(
            f"Expected a JSON object (mapping) as input, got {type(data).__name__}. "
            "The input file must contain a top-level object with keys: "
            "planning_period, shifts, workstations, employees."
        )

    return SchedulingInput(**data)


def validate_output(output: dict, input_data: SchedulingInput) -> List[str]:
    """Validate solver output against input constraints. Returns list of violations."""
    violations: List[str] = []

    # Build lookup tables from input
    emp_skills = {e.id: set(e.skills) for e in input_data.employees}
    emp_avail = {e.id: set(e.available_shifts) for e in input_data.employees}
    emp_unavail = {
        e.id: set(e.unavailability) for e in input_data.employees
    }
    ws_skills = {w.id: set(w.required_skills) for w in input_data.workstations}
    ws_shifts = {w.id: set(w.operating_shifts) for w in input_data.workstations}
    ws_by_id = {w.id: w for w in input_data.workstations}
    shift_night = {s.id: s.is_night_shift for s in input_data.shifts}

    # Track per-employee data for cross-day checks
    emp_assignments: dict = {}  # (emp_id, date) -> list of (shift_id, ws_id)
    emp_weekly: dict = {}  # (emp_id, week_num) -> count

    for day_entry in output.get("schedule", []):
        d = day_entry.get("date", "")
        wday = day_entry.get("weekday", "")

        for shift_entry in day_entry.get("shifts", []):
            sid = shift_entry.get("shift_id", "")
            sname = shift_entry.get("shift_name", "")

            for assign in shift_entry.get("assigned_dates", []):
                eid = assign.get("employee_id", "")
                wid = assign.get("workstation_id", "")

                # 1. Skill check
                if not ws_skills.get(wid, set()).issubset(emp_skills.get(eid, set())):
                    violations.append(
                        f"Skill mismatch: {eid} assigned to {wid} on {d} "
                        f"(requires {ws_skills.get(wid, set())}, "
                        f"has {emp_skills.get(eid, set())})"
                    )

                # 2. Shift availability
                if sid not in emp_avail.get(eid, set()):
                    violations.append(
                        f"Shift unavailable: {eid} not available for {sname} on {d}"
                    )

                # 3. Workstation operating shift
                if sid not in ws_shifts.get(wid, set()):
                    violations.append(
                        f"Workstation shift mismatch: {wid} does not operate "
                        f"during {sname} on {d}"
                    )

                # 4. Unavailability
                from datetime import datetime as dt
                try:
                    date_obj = dt.strptime(d, "%Y-%m-%d").date()
                    if date_obj in emp_unavail.get(eid, set()):
                        violations.append(
                            f"Unavailability: {eid} is unavailable on {d}"
                        )
                    # 4b. Closed workstation: deactivated, or inside a closure period
                    ws = ws_by_id.get(wid)
                    if ws is not None and (
                        not ws.available
                        or any(u.from_date <= date_obj <= u.to_date for u in ws.unavailability)
                    ):
                        violations.append(
                            f"Closed workstation: {wid} is closed on {d} but {eid} is assigned there"
                        )
                except ValueError:
                    pass

                # Track for cross-day checks
                key = (eid, d)
                if key not in emp_assignments:
                    emp_assignments[key] = []
                emp_assignments[key].append((sid, wid))

    # 5. No double shifts on same day
    for (eid, d), assignments in emp_assignments.items():
        if len(assignments) > 1:
            violations.append(
                f"Double shift: {eid} has {len(assignments)} assignments on {d}"
            )

    # 6. Night shift recovery
    cfg = input_data.constraints
    if cfg.night_shift_recovery_days > 0:
        from datetime import datetime as dt, timedelta
        night_dates = {}
        for (eid, d), assignments in emp_assignments.items():
            for sid, wid in assignments:
                if shift_night.get(sid, False):
                    if eid not in night_dates:
                        night_dates[eid] = []
                    date_obj = dt.strptime(d, "%Y-%m-%d").date()
                    night_dates[eid].append(date_obj)

        for eid, ndates in night_dates.items():
            for nd in ndates:
                for offset in range(1, cfg.night_shift_recovery_days + 1):
                    check_date = nd + timedelta(days=offset)
                    check_key = (eid, check_date.strftime("%Y-%m-%d"))
                    if check_key in emp_assignments:
                        violations.append(
                            f"Night recovery violated: {eid} works on "
                            f"{check_key[1]} (day {offset} after night shift on "
                            f"{nd.strftime('%Y-%m-%d')})"
                        )

    # 7. Weekly limit
    if cfg.max_working_days_per_week > 0:
        from datetime import datetime as dt
        emp_weekly = {}
        for (eid, d), assignments in emp_assignments.items():
            date_obj = dt.strptime(d, "%Y-%m-%d").date()
            iso_year, iso_week, _ = date_obj.isocalendar()
            week_key = (eid, iso_year, iso_week)
            emp_weekly[week_key] = emp_weekly.get(week_key, 0) + 1

        for (eid, iy, iw), count in emp_weekly.items():
            if count > cfg.max_working_days_per_week:
                violations.append(
                    f"Weekly limit exceeded: {eid} has {count} shifts in "
                    f"week {iy}-W{iw:02d} (max {cfg.max_working_days_per_week})"
                )

    return violations
