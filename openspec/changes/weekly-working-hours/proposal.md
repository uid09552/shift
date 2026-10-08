## Why

Contracts are expressed in hours per week, but employees only carry `monthly_working_hours`. Planners convert by hand, and months with different lengths give uneven targets.

## What Changes

- **BREAKING** Replace `monthly_working_hours` with `weekly_working_hours` on employees (API, DB, import/export template).
- Optimizer, agent plan check/repair, replacement ranking and fairness derive the target for any period from the weekly value (prorated by days).
- Employee form, Employee calendar and i18n labels (en/de) show weekly hours.
- Update docs (including the knowledge base) and the OpenAPI spec.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `employee-management`: contracted hours become weekly.

## Impact

Migration; `src/models/employee.rs`, repositories, `services/optimizer.rs`, `models/task_dto.rs`; `planner/shift_planner/models.py` and `optimizer.py`; `agent/shift_agent/agent/validation.py` and `replacement.py`; `api/openapi.yaml`; UI employee pages; seed scripts; tests; docs.
