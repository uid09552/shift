# Proposal

## Why

The planner enforces rest and workload rules (`min_rest_hours`, `max_consecutive_days`, `max_working_days_per_week`) as tenant-tunable numbers. Nothing ties them to German labour law, so a tenant can configure — or the solver can produce — a roster that breaches the Arbeitszeitgesetz (ArbZG), the Jugendarbeitsschutzgesetz (JArbSchG) or the Mutterschutzgesetz (MuSchG), and the plan check cannot say so. A hospital needs to know a roster is legal, and to tell a legal breach apart from a missed preference.

## What Changes

- Add a selectable **labor-law profile** to planner settings: `none` (today's behaviour, default) or `arbzg_de`.
- Under `arbzg_de` the optimizer treats these as hard rules:
  - max 10 h per working day (ArbZG §3; the 8 h norm is not modelled separately — the weekly-average rule below bounds it);
  - average ≤ 48 h/week over a configurable reference window of N weeks (default 24, `labor_law_averaging_weeks`);
  - minimum 11 h daily rest and break entitlement (30 min above 6 h, 45 min above 9 h), the break counted from shift definitions;
  - Sunday/holiday limits: at least 15 Sundays off per year (soft-reported, not solved).
- Add **protected groups** per employee, set on the Employees page:
  - minors (from a stored date of birth): max 8 h/day, 40 h/week, 5-day week, no nights, no Sundays/holidays beyond JArbSchG exceptions, 12 h rest;
  - pregnancy/maternity protection flag (MuSchG): no night shifts (20–06), no Sundays/holidays, max 8.5 h/day, 90 h per double-week.
- The **plan check** (`/agent/plan/validate`) reports legal violations in a separate `legal` section from soft-goal findings, with the statute and paragraph cited, so a roster's legality is readable at a glance.
- Take as Plan / publish show a warning (never a block) when the proposal has legal findings.
- Break rules need shift break data: add an optional unpaid `break_minutes` per shift.

Out of scope: collective-agreement (TVöD/TV-Ärzte) overrides, on-call (Bereitschaftsdienst) duty rules, other countries' profiles (the profile id leaves room for them), legal advice or certification.

## Capabilities

### New Capabilities
- `labor-law-profile`: selectable legal rule set (ArbZG), protected-group rules (JArbSchG, MuSchG), and the separate legal section of the plan check.

### Modified Capabilities
- `shift-optimization`: the rest/workload requirement gains legal hard rules when a profile is selected; plan check reports them apart from soft goals.
- `personal-limits`: an employee's personal limits may carry a date of birth and a maternity-protection flag.

## Impact

- DB: new migration — `planner_settings.labor_law_profile`, `labor_law_averaging_weeks`; `employee_personal_limits.date_of_birth`, `employee_personal_limits.maternity_protection`; `shifts.break_minutes`.
- Backend (Rust): `models/planner_settings.rs`, employee/shift models, repositories, `services/optimizer.rs` (input mapping), OpenAPI, audit-log redaction for the health flag.
- Planner (Python): `models.py` (`ConstraintConfig`, `Employee`, `Shift`), `optimizer.py` (hard constraints, 48 h average window).
- Agent: `validation.py` legal findings, `repair.py` respects legal rules.
- UI: planner settings, Employees page, Scheduler "Check & fix" tab.
- **Privacy**: the maternity flag is health-related data (GDPR Art. 9); see design.
