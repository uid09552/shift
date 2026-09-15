# Shift Planner

A constraint-based employee shift scheduling tool using Google OR-Tools CP-SAT solver.

## Overview

Given a JSON input describing employees, workstations, shifts, skills, unavailability, and priorities, the program produces an optimal 2-week shift plan as a JSON document.

## Features

- **Skill-based assignment** — employees are only assigned to workstations matching their skills
- **Shift availability** — employees can only work shifts they are available for
- **Unavailability** — respects employee date-specific unavailability
- **Shift wishes** — rewards fulfilling an employee's wish to work a specific shift on a specific date (`wish_weight`, soft)
- **Night shift recovery** — employees get 2 days off after a night shift
- **Fixed assignments** — `employees[].fixed_shifts` (`{date, shift_id}`, `shift_id: null` for a day off; rotation patterns write them) are kept ahead of coverage and every other goal; any a rule forbids is listed in `message`, never a reason for `infeasible`. `constraints.keep_fixed_assignments: false` ignores them
- **Coverage first** — minimum staffing is solved for before any other goal; balance, wishes and fatigue are optimised afterwards without un-filling a slot. Slots still short are listed in `message`
- **Workstation priority** — high-priority workstations are staffed first
- **Workload balancing** — penalises uneven shift distribution across employees
- **Max 5 shifts/week** — prevents over-scheduling

## Project Structure

```
shift_planner/           # Main package
├── __init__.py          # Package init & version
├── __main__.py          # python -m shift_planner support
├── cli.py               # CLI entry point (Click commands)
├── models.py            # Pydantic data models & validation
├── optimizer.py         # CP-SAT solver logic
├── server.py            # Flask REST API
└── nats_handler.py      # NATS JetStream subscriber
input.json               # Example input
input_shift.json         # Example input (shift-based)
output.json              # Generated output
pyproject.toml           # Project config, deps & entry point
Makefile                 # Common commands
README.md                # This file
```

## Input Format

See [`input.json`](input.json) for a full example. Key sections:

| Section | Description |
|---|---|
| `planning_period` | `start_date` and `end_date` (YYYY-MM-DD) covering 2 weeks |
| `shifts` | Shift definitions with id, name, start/end time, valid weekdays, `is_night_shift` flag |
| `workstations` | Workstation definitions with required skills, priority (`high`/`medium`/`low`), and operating shifts |
| `employees` | Employee definitions with skills, available shifts, and unavailability dates |

## Output Format

See [`output.json`](output.json) (generated). Key sections:

| Section | Description |
|---|---|
| `status` | `optimal`, `feasible`, or `infeasible` |
| `objective_value` | Solver objective score |
| `schedule` | Per-day list of assignments (employee → shift → workstation) |
| `employee_summary` | Per-employee totals (shifts, night shifts, assigned dates) |

## Installation

### Prerequisites

- Python >= 3.11
- [uv](https://docs.astral.sh/uv/) (install with `curl -LsSf https://astral.sh/uv/install.sh | sh`)

### Setup

```bash
make install
```

Or manually:

```bash
uv sync
```

## Usage

The package installs a `shift-planner` CLI command. All commands can also be run via `uv run`:

### Run scheduler once (file-based)

```bash
# Default: reads input.json, writes output.json
make schedule

# Custom input/output files
uv run shift-planner schedule my_input.json my_output.json
```

### NATS JetStream subscriber mode

```bash
# Start with defaults
make nats

# Custom options
uv run shift-planner nats --queue-name scheduling --stream-name SCHEDULING --broker-url nats://localhost:4222
```

### REST API mode (Flask)

```bash
# Start with defaults (0.0.0.0:8888)
make api

# Custom host/port
make api-custom

# Debug mode
make api-debug
```

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/optimize` | Submit scheduling input as JSON, receive the computed schedule |
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/` | API information |

#### Example request

```bash
curl -X POST http://localhost:8888/api/v1/optimize \
  -H "Content-Type: application/json" \
  -d @input.json
```

#### Example response

```json
{
  "status": "optimal",
  "objective_value": 8500,
  "planning_period": { "start_date": "2026-06-05", "end_date": "2026-07-05" },
  "schedule": [ ... ],
  "employee_summary": [ ... ]
}
```

#### Error responses

- **415** — Content-Type is not `application/json`
- **400** — Malformed JSON body
- **422** — Input validation error (Pydantic) or infeasible schedule
- **500** — Internal solver error

### Running as a Python module

```bash
uv run python -m shift_planner schedule
uv run python -m shift_planner api --port 8080
```

## Makefile Commands

| Command | Description |
|---------|-------------|
| `make install` | Install uv and sync dependencies |
| `make sync` | Re-sync dependencies after pyproject.toml changes |
| `make schedule` | Run scheduler once (input.json → output.json) |
| `make schedule-custom` | Run with input_shift.json |
| `make nats` | Start NATS JetStream subscriber + REST API on :8888 (`--no-api` to leave it out) |
| `make nats-custom` | Start NATS with custom options |
| `make api` | Start REST API on 0.0.0.0:8888 |
| `make api-custom` | Start REST API on 127.0.0.1:8080 |
| `make api-debug` | Start REST API in debug mode |
| `make test-api` | Smoke test the REST API |
| `make clean` | Remove .venv and build artifacts |
| `make help` | Show all available commands |

## Constraints

1. **One assignment per slot** — at most one employee per (day, shift, workstation) and at most one workstation per (employee, day, shift)
2. **No double shifts** — at most one shift per employee per day
3. **Night recovery** — 2 full days off after any night shift
4. **Weekly limit** — max 5 working days per employee per calendar week
5. **Skill match** — employee must possess all required skills for the workstation
6. **Shift availability** — employee must be available for the shift
7. **Date availability** — employee must not be marked unavailable on the date
8. **Weekday match** — shift must operate on the given weekday
