## 1. Database and backend

- [x] 1.1 Migration (with down): nullable `employees.weekly_working_hours` converted from monthly (`round(m × 12 / 52 × 2) / 2`, `NULL` where 0), drop `monthly_working_hours`; `planner_settings.default_weekly_working_hours` default 40
- [x] 1.2 Update `schema.rs`, employee and planner-settings models, domain types and repositories
- [x] 1.3 Planner settings: read/validate/write `default_weekly_working_hours` (0 < h ≤ 168), included in the audit entry
- [x] 1.4 Employee service: optional `weekly_working_hours` on create/update (absent = unchanged, `null` = default, 0 ≤ h ≤ 168), 400 on `monthly_working_hours`, responses with `effective_weekly_working_hours`
- [x] 1.5 Optimizer input and `/planner/prepare`: send the effective value as `weekly_working_hours` (`services/optimizer.rs`, `models/task_dto.rs`)
- [x] 1.6 Fairness target as `effective × days / 7` (`repository/analysisrepository.rs`)
- [x] 1.7 Import/export template: `weekly_working_hours` column, empty = default, old header refused with a clear message
- [x] 1.8 `api/openapi.yaml`: employee and planner-settings schemas, the 400

## 2. Planner and agent

- [x] 2.1 Planner model field `weekly_working_hours`; target `weekly × num_days / 7`, 0 still skipped; test in `planner/tests/`
- [x] 2.2 Agent `validation.py` and `replacement.py` targets as `weekly × days / 7`; MCP tool descriptions; update `test_replacement.py` and add a check-target test

## 3. UI

- [x] 3.1 Services and types: employee (`weekly_working_hours`, `effective_weekly_working_hours`), planner settings (`default_weekly_working_hours`)
- [x] 3.2 Employee form and list (`user-profiles`): optional weekly hours with the default as placeholder and a reset to default; list shows effective hours and marks defaulted ones
- [x] 3.3 Planner Settings: default weekly hours field; relabel the contract-hours weight; presets unaffected
- [x] 3.4 Employee calendar and Fairness: weekly-based targets from the backend
- [x] 3.5 i18n labels in `en.ts` and `de.ts`; `data-testid` on the new fields

## 4. Data, tests and docs

- [x] 4.1 `seed_data_v2.py` writes weekly hours; Rust integration tests that create employees use the new field
- [x] 4.2 Rust tests: default 40 applies, own value wins, default change moves only defaulted employees, `null` resets, monthly field refused, viewer cannot change the default, migration conversion (160 → 37, 0 → default)
- [x] 4.3 Update docs (domain-model, database, api, planner, ui-proposals, knowledge: concepts/employee, concepts/planner-settings, optimizer-contract, rest-api, objective-terms, planner-settings-reference, database-and-migrations, creating-a-schedule) and tick item 1 in `todo.txt`
