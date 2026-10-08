## Context

Hours target is read by the Rust backend, the planner, and the agent, each from `monthly_working_hours`.

## Decisions

- Store `weekly_working_hours`; migration converts existing rows as `monthly * 12 / 52` (rounded to 0.5).
- Period target = `weekly * days_in_period / 7`. Calendar-month targets use the month's day count. Resolved in the backend where possible so the planner contract changes minimally; if the planner input keeps a per-period target field, document it in the optimizer contract.
- No dual-field transition: single breaking change, down migration reverses the conversion.

## Risks

- Rounding drift on migrate: acceptable, planners can edit.
- Third-party importers using the old column: update the template and reject the old header with a clear error.
