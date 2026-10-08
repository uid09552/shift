## Why

Contracts are expressed in hours per week, but employees only carry `monthly_working_hours`. Planners convert by hand, months of different length give uneven targets (the optimizer prorates by `days / 30`), and every new employee has to be given a number even though most work the same full-time week. This is item 1 in `todo.txt`.

## What Changes

- **BREAKING** Replace `monthly_working_hours` with an optional `weekly_working_hours` on employees (API, DB, import/export template). Empty means "follow the tenant default"; `0` still means "no hours target".
- New tenant-wide setting `default_weekly_working_hours` in planner settings, **40 h** unless changed. Changing it moves every employee without their own value.
- Employee API responses also carry `effective_weekly_working_hours`: the employee's own value or the default.
- The backend resolves the effective value before anything else reads it: the optimizer input, `/planner/prepare` (and so the agent's plan check, repair and replacement ranking), and Fairness. Each derives a period target as `weekly × days / 7`.
- Migration converts existing values (`monthly × 12 / 52`, rounded to 0.5) into per-employee values. Employees at `0` (never set) follow the default from then on.
- UI: the employee form shows weekly hours with the default as a placeholder and a way back to it; Planner Settings gets the default field; the Employee calendar and Fairness show weekly-based targets; en/de labels.
- Seed data, docs (including the knowledge bundle) and the OpenAPI spec follow.

Out of scope: the tenant-wide weekly min/max band (`weekly_min_hours` / `weekly_max_hours`) and the target weights stay as they are; part-time patterns (different hours per week) are not modelled.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `employee-management`: contracted hours become weekly and optional, with a tenant-wide default of 40 h that the optimizer target follows.

## Impact

- **DB:** migration on `employees` (new nullable column, conversion, old column dropped) and `planner_settings` (new column, default 40).
- **Backend:** `src/schema.rs`, employee and planner-settings models, repositories and services, `services/optimizer.rs`, `models/task_dto.rs`, `repository/analysisrepository.rs` (Fairness), the import/export template.
- **Planner:** `planner/shift_planner/models.py` and `optimizer.py` (input field and target proration).
- **Agent:** `validation.py`, `replacement.py`, MCP tool descriptions; agent tests.
- **API:** `api/openapi.yaml`. Clients sending `monthly_working_hours` get a clear 400.
- **UI:** employee form (`user-profiles`), Planner Settings, Employee calendar, Fairness, services, i18n.
- **Data and tests:** `seed_data_v2.py`, Rust integration tests that create employees, planner tests.
- **Docs:** domain model, database, API, planner, configuration of planner settings, knowledge bundle.
