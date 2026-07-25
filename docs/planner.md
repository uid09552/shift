# Optimizer (Shift Planner)

The Python service in `planner/` turns a description of the ward into a
staffing plan, using Google OR-Tools' CP-SAT solver. It has no database and no
state: JSON in, JSON out.

## Package layout

```
planner/shift_planner/
├── cli.py           Click commands: schedule, api, nats
├── models.py        Pydantic input/output models and validation
├── optimizer.py     the CP-SAT model — constraints and objective
├── server.py        Flask REST API
└── nats_handler.py  NATS JetStream subscriber
```

## Three ways to run it

=== "One-shot"

    ```bash
    cd planner
    make schedule                    # input.json -> output.json
    uv run shift-planner schedule my_input.json my_output.json
    ```

=== "REST API"

    ```bash
    make api        # 0.0.0.0:8888
    curl -X POST http://localhost:8888/api/v1/optimize \
      -H "Content-Type: application/json" -d @input.json
    ```

=== "NATS (production)"

    ```bash
    make nats       # stream SCHEDULING, subject scheduling
    ```

    This is how the backend talks to it: tasks arrive on `scheduling`, results
    go back on `scheduling.results`.

## Input

The contract is `SchedulingInput` in `models.py`; `planner/input.json` is a
worked example. The backend builds this payload from the database — call
`POST /api/v1/planner/prepare` to see exactly what it would send.

| Section | Contents |
|---|---|
| `planning_period` | `start_date`, `end_date` |
| `shifts` | `id`, `name`, `is_night_shift`, `weekday_times[]` |
| `workstations` | `id`, `name`, `required_skills`, `priority`, `operating_shifts`, `min/max_employees`, `unavailability[]` |
| `employees` | `id`, `name`, `skills`, `available_shifts`, `unavailability[]`, `monthly_working_hours`, `preferred_off[]` |
| `capabilities` | `id`, `level`, `skill_group` — for the skill-downgrade objective |
| `constraints` | the `ConstraintConfig` block below |

Each `weekday_times` entry carries `weekday`, start/end times,
`min_employees`, `max_employees` and `free_days_after_shift`. A weekday absent
from the list is a weekday the shift does not run.

## Output

| Field | Meaning |
|---|---|
| `status` | `optimal`, `feasible`, or `infeasible` |
| `objective_value` | Solver score — comparable only between runs of the same model |
| `schedule` | Per-day → per-shift → assignments (employee → workstation) |
| `employee_plans` | Per-employee daily plan, including `free` days |
| `message` | Diagnostics, notably on infeasibility |

## The model

### Hard constraints

Violating any of these makes a solution invalid.

1. **One workstation per employee, day and shift.**
2. **Maximum employees per (day, shift, workstation)** — a post cannot be
   overstaffed.
3. **One shift per employee per day** — no double shifts.
4. **Maximum employees per (day, shift)** across all workstations.
5. **Forced recovery days after a shift** — `free_days_after_shift`, generalised
   from the night-shift rule to any shift type.
6. **Maximum working days per week** (`max_working_days_per_week`, `0` disables).
7. **Minimum rest between shifts on consecutive days** (`min_rest_hours`, `0`
   disables) — this is what rules out a late shift followed by an early one.
8. **Maximum consecutive working days** (`max_consecutive_days`, `0` disables).
9. **Skills and availability** — an employee is only eligible for a workstation
   whose required skills they hold, in a shift they are available for, on a day
   they are not hard-unavailable, at a workstation that is open.

Note the asymmetry on staffing bands: **maximum is hard, minimum is soft.** If
minimum staffing were hard, a short-staffed week would return `infeasible` and
tell the planner nothing. As a penalty, the solver instead returns the best
achievable plan and makes the shortfall visible.

### Objective terms

The solver maximises a weighted sum:

| Term | Effect |
|---|---|
| Staffing shortfall | Penalises falling below `min_employees` |
| Coverage | Rewards assignments, weighted by workstation priority |
| Equal treatment | Minimises the spread of working hours across employees (`equality_weight`) |
| Monthly hours target | Symmetric penalty on deviation from each employee's contracted hours |
| Weekly hour band | Soft `weekly_min_hours` / `weekly_max_hours` over 7-day blocks |
| Preferences | Penalises overriding a soft `preferred_off` entry |
| Skill downgrade | Penalises staffing a post with an over-qualified person, by level gap within a `skill_group` |
| Fatigue | Ergonomic cost per shift, amplified for night shifts; minimises the **worst-off** employee's fatigue rather than the average |
| Shift continuity | Rewards keeping the same shift on consecutive days, with a bonus for a whole week |

The fatigue term is deliberately minimax: an average-based cost is happy to
wreck one person's month as long as the team's mean looks fine.

## Tunable settings

`ConstraintConfig` in `models.py` defines the defaults; the backend mirrors them
in `planner_settings` per tenant and sends them with every task. Edit them
through `PUT /api/v1/planner-settings` or the UI's planner settings page.

| Setting | Default | Meaning |
|---|---|---|
| `night_shift_recovery_days` | `2` | Rest days after a night shift (`0` disables) |
| `min_rest_hours` | `11.0` | Minimum rest between consecutive-day shifts (`0` disables) |
| `max_consecutive_days` | `6` | Consecutive working-day cap (`0` disables) |
| `max_working_days_per_week` | `5` | Working days per week cap (`0` disables) |
| `equality_weight` | `50000` | Weight on even workload distribution |
| `priority_weights` | `high: 10000, medium: 1000, low: 100` | Coverage reward per workstation priority |
| `shift_continuity_weight` | `500` | Reward for the same shift on consecutive days |
| `shift_continuity_week_bonus` | `2000` | Extra reward for a consistent week |
| `monthly_hours_target_weight` | `1000` | Weight on hitting contracted monthly hours |
| `weekly_min_hours` / `weekly_max_hours` | `None` | Optional soft weekly hour band |
| `weekly_hours_target_weight` | `1000` | Weight on that band |
| `preference_weight` | `300` | Cost of overriding a soft preference |
| `skill_downgrade_weight` | `200` | Cost per level of over-qualification |
| `fatigue_weight` | `100` | Weight on the ergonomic term |
| `night_shift_fatigue_multiplier` | `2.0` | Night-shift fatigue factor |
| `solver_time_limit_seconds` | `120.0` | Wall-clock budget |
| `solver_num_workers` | `8` | Parallel search workers |

The weights are on wildly different scales on purpose — `equality_weight` at
50000 against `fatigue_weight` at 100 encodes a lexicographic-ish priority
order in a single objective. Change one by an order of magnitude and you change
which term wins, not just how much it matters.

`solver_time_limit_seconds` is the honest knob for plan quality: CP-SAT returns
the best solution found within its budget, so a `feasible` result on a large
ward often just means the timer expired.

## Provenance

The skill-downgrade, soft-preference, weekly-hour-band and fatigue terms
implement the objectives of the nurse-scheduling literature (Khalili et al.,
2020), added in migration
`00000000000022_paper_algorithm_extensions`. Defaults were chosen so that
existing tenants see no behaviour change until they deliberately group and rank
capabilities or mark preferences soft.

## Diagnosing an infeasible result

`infeasible` means the hard constraints cannot all be satisfied. In practice it
is nearly always one of:

- an employee needed for a post who lacks a required capability;
- a shift with no `weekday_times` row for a day it is expected to run;
- `max_working_days_per_week` or `max_consecutive_days` set too tight for the
  headcount;
- `min_rest_hours` making a shift sequence impossible;
- unavailability that removes the only qualified person for a mandatory post.

`POST /api/v1/planner/prepare` returns the exact payload without solving —
start there.
