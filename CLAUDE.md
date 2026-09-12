# Hospital Shift Management System - Project Context

## Overview

This is a **Hospital Shift Management System** - a full-stack application for managing hospital employee shift scheduling, capabilities, and workstation assignments. The system consists of a Rust backend with a PostgreSQL database, an Angular frontend, and a Python-based optimization service.

## Architecture

### Backend (Rust)
- **Framework**: Axum 0.7 (async web framework)
- **ORM**: Diesel 2.1 with PostgreSQL
- **Architecture Pattern**: Hexagonal/Clean Architecture with domain services
- **Message Broker**: NATS (async-nats) for async task processing
- **API Style**: RESTful API with OpenAPI 3.0 specification

### Frontend (Angular)
- **Framework**: Angular 21 with TypeScript
- **UI Library**: Tailwind CSS with TailAdmin template
- **Charts**: ApexCharts, AMCharts 5
- **Calendar**: FullCalendar
- **UI Components**: Angular Material

### Optimizer Service (Python)
- **Language**: Python 3.11+
- **Solver**: Google OR-Tools CP-SAT solver
- **Framework**: Flask for REST API
- **Message Broker**: NATS JetStream subscriber
- **Package Manager**: uv (modern Python package manager)

## Project Structure

```
backend/
├── src/
│   ├── main.rs              # Application entry point with CLI
│   ├── lib.rs               # Library exports
│   ├── server.rs            # HTTP server setup and routing
│   ├── config.rs            # Configuration management (Figment)
│   ├── database.rs          # Database connection pool
│   ├── broker.rs            # NATS message broker integration
│   ├── errors.rs            # Error types and handling
│   ├── schema.rs            # Diesel generated schema
│   ├── models/              # Data models and DTOs
│   │   ├── employee.rs      # Employee entity
│   │   ├── shift.rs         # Shift definitions
│   │   ├── capability.rs    # Worker capabilities/skills
│   │   ├── workstation.rs   # Workstation definitions
│   │   ├── unavailability.rs # Employee unavailability
│   │   ├── employee_shift_assignment.rs # Fixed shift assignments
│   │   ├── confirmed_shift_plan.rs # Confirmed monthly plans
│   │   └── optimized_shift_result.rs # Optimizer results
│   ├── repository/          # Data access layer
│   │   ├── domain.rs        # Repository traits
│   │   ├── employeerepository.rs
│   │   ├── shiftrepository.rs
│   │   └── ...
│   └── services/            # Business logic layer
│       ├── employee.rs
│       ├── shift.rs
│       ├── capability.rs
│       ├── workstation.rs
│       ├── optimizer.rs     # Shift optimization service
│       └── ...
├── migrations/              # Diesel database migrations
├── api/
│   └── openapi.yaml         # OpenAPI 3.0 specification
├── planner/                 # Python optimizer service
│   ├── shift_planner/       # Main package
│   │   ├── __init__.py     # Package init & version
│   │   ├── __main__.py     # python -m shift_planner support
│   │   ├── cli.py          # CLI entry point (Click commands)
│   │   ├── models.py       # Pydantic data models & validation
│   │   ├── optimizer.py    # CP-SAT solver logic
│   │   ├── server.py       # Flask REST API
│   │   └── nats_handler.py # NATS JetStream subscriber
│   ├── input.json          # Example input
│   ├── input_shift.json    # Example input (shift-based)
│   ├── output.json         # Generated output
│   ├── pyproject.toml      # Project config & dependencies
│   ├── Makefile            # Common commands
│   └── README.md           # Optimizer documentation
├── ui/                      # Angular frontend
│   └── src/app/
│       ├── pages/
│       │   ├── dashboard/   # Main dashboard
│       │   ├── planner/     # Scheduling components
│       │   │   ├── kalender/        # Weekly schedule view
│       │   │   ├── day-view/        # One day as an hourly Gantt chart
│       │   │   ├── scheduler/       # Optimization UI (verify + fix a proposal)
│       │   │   └── employee-calendar/
│       │   └── configuration/  # Admin settings
│       │       ├── shifts/
│       │       ├── workstations/
│       │       ├── capabilities/
│       │       └── users/           # Organization users & role assignment
│       └── shared/
│           ├── services/    # HTTP services for API calls
│           └── components/  # Reusable UI components
├── e2e/                     # Robot Framework UI tests (see e2e/README.md)
│   ├── config/config.yaml   # Target URL, browser settings, accounts
│   ├── resources/           # Keywords + page objects (tests hold no selectors)
│   └── tests/overview/      # Overview page suites
└── deploy/                  # Docker deployment files
```

## Core Domain Concepts

### Employees
- Hospital staff with personal information
- Have associated capabilities (skills/qualifications)
- Can have unavailability periods
- Monthly working hour targets

### Shifts
- Defined work periods (e.g., Early, Late, Night shift)
- Have start/end times for each weekday
- Color-coded for visualization
- Employee limits per shift per weekday

### Capabilities
- Skills or qualifications required for workstations
- Examples: "Intensive Care", "Emergency Room", "Surgery"
- Assigned to employees and required by workstations

### Workstations
- Hospital units/departments
- Have required capabilities
- Active shifts assigned per workstation

### Shift Assignments
- Fixed assignments of employees to specific shifts
- Used for recurring schedules

### Confirmed Shift Plans
- Monthly confirmed schedules per employee
- Store the final approved shift assignments

### Shift Wishes
- An employee's request for a specific shift on a specific date
- A soft reward for the optimizer (`wish_weight`), never a guarantee
- Employees with the `shift-viewer` role enter their own; planners and admins
  enter anyone's
- Whether a wish may be placed at all, and for which dates, is the **wish
  window** (`wish_settings`, one row per tenant): `enabled` / `disabled` /
  `date_range` with `window_start`/`window_end`
- The window binds **every** role, `shift-admin` included — it is a lock, not a
  self-service policy. Only `shift-admin` may change it

### Users and roles
- A user is a **Keycloak** account, not a row in this database; a tenant is a
  Keycloak **organization**, and belonging to one is organization membership
- Three realm roles: `shift-admin`, `shift-planner`, `shift-viewer`
- `shift-admin` alone may add users to their own organization and assign roles
  (`/users`, backed by the Keycloak Admin API — see `services/keycloak.rs`)
- An admin cannot take `shift-admin` off themselves or remove themselves from the
  organization — that would lock the last admin out

### Optimized Shift Results
- Results from the optimization algorithm
- Generated by external Python optimizer service
- A **proposal**, not a roster: editable on the scheduler page, checkable
  (`/agent/plan/validate`) and repairable (`/agent/plan/fix`) until someone
  presses *Take as Plan*

## API Endpoints

Base URL: `http://localhost:8080/api/v1`

### Main Resources
- `GET/POST /employees` - Employee management
- `GET/POST /shifts` - Shift definitions
- `GET/POST /capabilities` - Capability management
- `GET/POST /workstations` - Workstation management
- `GET/POST /unavailability` - Employee unavailability
- `GET/POST /shift-wishes` - Employee shift wishes
- `GET/PUT /wish-settings` - Shift-wish window (PUT: `shift-admin` only)
- `GET/POST /users` - Users of the caller's organization (`shift-admin` only)
- `PUT /users/{id}/roles` - Replace a user's shift roles (`shift-admin` only)
- `DELETE /users/{id}` - Remove a user from the organization (`shift-admin` only)
- `POST /planner/optimize` - Trigger shift optimization
- `POST /agent/plan/validate` - Check a proposed plan against the rules it was
  solved under (served by the agent, not the Rust backend — see `agent/`)
- `POST /agent/plan/fix` - Repair a proposed plan and save it: move whoever
  breaks a hard rule somewhere legal, fill what is short, and carry out the
  planner's own instruction where the rules allow. `strategy` is `repair`
  (local moves) or `resolve` (re-solve the period, keeping what was pinned).
  Also served by the agent — see `agent/shift_agent/agent/repair.py`
- `GET/POST /shift-assignments` - Fixed shift assignments
- `GET/POST /confirmed-shift-plans` - Confirmed monthly plans
- `GET /analysis/*` - Analysis and summary endpoints

## Development Commands

### Backend
```bash
make build        # Build the project
make serve        # Start the server (default: port 8080)
make db-up        # Start PostgreSQL database
make db-down      # Stop PostgreSQL database
make test         # Run tests
make check        # Check code without building
```

### Frontend
```bash
cd ui && npm start    # Start Angular dev server
cd ui && npm run build # Build for production
```

### Optimizer Service (Python)
```bash
cd planner && make install     # Install dependencies with uv
cd planner && make schedule    # Run scheduler with default input
cd planner && make api         # Start REST API server (default: port 8888)
cd planner && make nats       # Start NATS JetStream subscriber
```

### End-to-End UI Tests (Robot Framework)
```bash
make e2e-install                                  # one-time: venv + browsers
make e2e                                          # run against http://localhost
make e2e ARGS="--include smoke"                   # a subset, by tag
cd e2e && make dryrun                             # resolve keywords, no browser
```
Needs a running stack (gateway, UI, backend, Keycloak). Locators are
`data-testid` attributes; see `e2e/README.md`.

### Full Development Setup
```bash
# 1. Start database
make db-up

# 2. Set environment variables
export DATABASE_URL=postgresql://shift_user:shift_password@localhost:5432/shift

# 3. Start backend
make serve

# 4. Start optimizer service (in another terminal)
cd planner && make api

# 5. Start frontend (in another terminal)
make ui-serve
```

## Database Configuration

Default connection settings:
- **Host**: localhost
- **Port**: 5432
- **Database**: shift
- **User**: shift_user
- **Password**: shift_password

Connection URL: `postgresql://shift_user:shift_password@localhost:5432/shift`

## Key Technologies

### Backend Dependencies
- `tokio` - Async runtime
- `axum` - Web framework
- `diesel` - ORM with PostgreSQL support
- `serde` / `serde_json` - Serialization
- `chrono` - Date/time handling
- `uuid` - UUID generation
- `async-nats` - NATS message broker
- `reqwest` - HTTP client for optimizer calls
- `clap` - CLI argument parsing
- `figment` - Configuration management

### Frontend Dependencies
- `@angular/core` 21 - Angular framework
- `@angular/material` - Material Design components
- `tailwindcss` 4 - Utility-first CSS
- `@fullcalendar/angular` - Calendar component
- `apexcharts` / `ng-apexcharts` - Charts
- `@amcharts/amcharts5` - Advanced charts
- `rxjs` - Reactive programming

### Optimizer Dependencies (Python)
- `ortools` - Google OR-Tools CP-SAT solver
- `pydantic` - Data validation and models
- `flask` - REST API framework
- `nats-py` - NATS JetStream client
- `click` - CLI framework

## External Services

### Python Optimizer Service
The system integrates with a Python-based optimization service for shift scheduling using constraint programming:

**Location**: `planner/` directory

**Features**:
- **Skill-based assignment** — employees only assigned to workstations matching their skills
- **Shift availability** — employees can only work shifts they are available for
- **Unavailability** — respects employee date-specific unavailability
- **Night shift recovery** — employees get 2 days off after a night shift
- **Workstation priority** — high-priority workstations are staffed first
- **Workload balancing** — penalizes uneven shift distribution across employees
- **Max 5 shifts/week** — prevents over-scheduling
- **Shift continuity** — rewards same shift on consecutive days

**Integration Modes**:
1. **HTTP REST API** (`planner/shift_planner/server.py`)
   - Endpoint: `POST /api/v1/optimize`
   - Default port: 8888
   - Receives JSON input, returns optimized schedule

2. **NATS JetStream Subscriber** (`planner/shift_planner/nats_handler.py`)
   - Listens for scheduling requests on NATS queue
   - Processes requests asynchronously
   - Responds via NATS reply subject
   - This is how the **backend** plans (`POST /planner/plan` → task id → poll)

The REST mode is what the **agent** uses: the MCP server's `optimizeSchedule`
tool posts to it and waits, which a queue cannot offer. In
`deploy/docker-compose.yml` that is the `planner-api` service (same image as
`planner`, `shift-planner api` instead of the NATS subscriber), reached through
`OPTIMIZER_URL`.

**Input Format** (see `planner/input.json`):
```json
{
  "planning_period": { "start_date": "2024-01-01", "end_date": "2024-01-14" },
  "shifts": [...],
  "workstations": [...],
  "employees": [...],
  "constraints": { ... }
}
```

**Output Format**:
```json
{
  "status": "optimal|feasible|infeasible",
  "objective_value": 12345,
  "schedule": [...],
  "employee_summary": [...]
}
```

**Configurable Constraints**:
- `night_shift_recovery_days`: int (default 2, 0=disabled)
- `min_rest_hours`: float (default 11.0, 0=disabled)
- `max_consecutive_days`: int (default 6, 0=disabled)
- `max_working_days_per_week`: int (default 5, 0=disabled)
- `equality_weight`: int (default 50000)
- `priority_weights`: dict (default {"high":10000,"medium":1000,"low":100})
- `wish_weight`: int (default 20000, 0=disabled) — reward for fulfilling an employee shift wish
- `min_staffing_mode`: "soft" | "hard" (default "soft") — whether each shift's
  and workstation's `min_employees` is a penalised target or a requirement the
  solver may not break (hard can return `infeasible`)
- `solver_time_limit_seconds`: float (default 120.0)
- `solver_num_workers`: int (default 8)

Alongside `constraints`, the input carries `locked_assignments` —
`{employee_id, date, shift_id, workstation_id}` rows the solver must keep. They
turn a re-solve into a repair: the model plans around them instead of
re-deciding them. Impossible locks are dropped and reported in `message`.

### NATS JetStream
Used for asynchronous task processing:
- Optimization tasks are published to JetStream
- Python optimizer subscribes and processes tasks asynchronously
- Status tracking for optimization jobs
- Default stream: `SCHEDULING`, queue: `scheduling`

## Configuration

Configuration is managed via `config.yaml` and environment variables:

```yaml
# Example configuration structure
server:
  port: 8080
  listen: "127.0.0.1"

database:
  url: "postgresql://..."

nats:
  url: "nats://localhost:4222"

# Only the user-management endpoints use this; empty url = they answer 503
keycloak:
  url: "http://keycloak:8080/auth"
  realm: "shift"
  client_id: "shift-gateway"
  client_secret: "..."

optimizer:
  url: "http://optimizer:8000"
```

## Testing

Tests are located in the `tests/` directory. Run with:
```bash
make test
```

## Docker Deployment

Docker files are in `deploy/`:
- `Dockerfile.backend` - Rust backend container
- `Dockerfile.ui` - Angular frontend container
- `docker-compose.yml` - Full stack deployment
- `nginx.conf` - Frontend web server configuration

## Important Files for Development

### Backend (Rust)
- [`api/openapi.yaml`](api/openapi.yaml) - Complete API specification
- [`DATABASE.md`](DATABASE.md) - Database setup details
- [`README.md`](README.md) - Project overview
- [`Makefile`](Makefile) - Build and run commands
- [`src/schema.rs`](src/schema.rs) - Database schema (auto-generated by Diesel)
- [`src/repository/domain.rs`](src/repository/domain.rs) - Repository trait definitions

### End-to-End Tests (Robot Framework)
- [`e2e/README.md`](e2e/README.md) - How to install, run and extend the UI tests
- [`e2e/config/config.yaml`](e2e/config/config.yaml) - Target URL, browser settings, accounts

### Optimizer (Python)
- [`planner/README.md`](planner/README.md) - Optimizer service documentation
- [`planner/pyproject.toml`](planner/pyproject.toml) - Python project config
- [`planner/Makefile`](planner/Makefile) - Optimizer commands
- [`planner/shift_planner/optimizer.py`](planner/shift_planner/optimizer.py) - CP-SAT solver logic
- [`planner/shift_planner/models.py`](planner/shift_planner/models.py) - Pydantic data models
- [`planner/shift_planner/server.py`](planner/shift_planner/server.py) - Flask REST API
- [`planner/shift_planner/nats_handler.py`](planner/shift_planner/nats_handler.py) - NATS subscriber
- [`planner/input.json`](planner/input.json) - Example input data
