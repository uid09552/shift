"""
Data models for shift planning with validation using Pydantic.
"""

from datetime import date, time
from typing import Dict, List, Optional

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


class Shift(BaseModel):
    """Shift definition with time and operating days."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    start_time: time
    end_time: time
    weekdays: List[str] = Field(..., min_length=1)
    is_night_shift: bool = False
    min_employees: int = Field(default=1, ge=0)
    max_employees: Optional[int] = Field(default=None, ge=0)

    @field_validator("weekdays")
    @classmethod
    def valid_weekdays(cls, v):
        """Validate that weekdays are valid day names."""
        valid_days = {
            "0",
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
        }
        for day in v:
            if day not in valid_days:
                raise ValueError(f"Invalid weekday: {day}. Must be one of {valid_days}")
        return v


class Workstation(BaseModel):
    """Workstation definition with skills and priority."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    required_skills: List[str] = Field(default_factory=list)
    priority: str = Field(default="medium")
    operating_shifts: List[str] = Field(..., min_length=1)

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


class Employee(BaseModel):
    """Employee definition with skills and availability."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    skills: List[str] = Field(default_factory=list)
    available_shifts: List[str] = Field(..., min_length=1)
    unavailability: List[date] = Field(default_factory=list)


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
    status: str  # "assigned" or "not_assigned"
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
    shift_night = {s.id: s.is_night_shift for s in input_data.shifts}
    shift_wdays = {s.id: set(s.weekdays) for s in input_data.shifts}

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
