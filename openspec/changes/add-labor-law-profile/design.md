## Context

Rest and workload limits live in `planner_settings` and `ConstraintConfig`, are enforced in `planner/shift_planner/optimizer.py` and mirrored in `agent/shift_agent/agent/validation.py` ("kept identical to the solver's"). Validation findings are a flat list with `error`/`warning` severity. Employees have no age or protection data; shifts have per-weekday start/end but no break.

## Goals / Non-Goals

**Goals:** a selectable profile; legal rules as hard solver constraints; legal findings reported apart from soft goals; protected-group handling with minimal sensitive data.
**Non-Goals:** collective agreements, on-call duty, non-German law, legal certification.

## Decisions

1. **Profile as a setting, rules as data.** `labor_law_profile` (`none` | `arbzg_de`) on planner settings. The Python side expands the profile into a `LegalRules` struct (max day hours, avg hours/weeks, rest, break tiers, minor and maternity limits) in a new `planner/shift_planner/legal.py`. The agent ships as its own image without the planner package, so it carries a byte-identical copy (`agent/shift_agent/agent/legal.py`) and `planner/tests/test_legal.py` fails when the two differ — one source of truth in effect, avoiding the solver/validator drift the code already warns about. Alternative (more settings columns per number) rejected: legal values should not be tenant-editable, only the averaging window.
2. **Legal rules are hard, and compose with tenant limits by taking the stricter value.** E.g. rest = max(`min_rest_hours`, 11). If legal rules make coverage impossible, coverage is reported short (as for other hard rules), never silently violated. Alternative (soft penalty) rejected: a legal breach must not be tradeable for a preference.
3. **48 h average via rolling window.** For each employee and each window of N weeks ending in the period, sum hours (including `history`, extended beyond 14 days — see Open Questions) ≤ 48·N. Days in window before data are assumed empty. Modelled linearly in CP-SAT over shift-hour coefficients.
4. **Breaks from shift definition.** `shifts.break_minutes` (nullable, default 0). Required break derived from gross length (>6 h: 30, >9 h: 45); a shift whose `break_minutes` is below it is a *shift definition* finding, reported once per shift, not per assignment, and its net hours are used for the daily/weekly caps.
5. **Protected groups.** `date_of_birth` (minor = under 18 on the day) and a `maternity_protection` boolean on `employee_personal_limits` — the table that already holds per-person protections (its migration names pregnancy and age), served by `/employees/{id}/personal-limits` — stored — not "pregnant", no due date. Rules resolved per employee-day by `legal.py`. Alternative (free-text status) rejected: minimises sensitive data.
6. **Separate legal report.** Validation output gains `legal: {profile, findings[], compliant}` beside the existing `findings`; legal findings carry `statute` (e.g. `ArbZG §3`). Legal rules are removed from the soft list to avoid double reporting.
7. **Privacy of the maternity flag.** Readable/writable by `shift-admin` and `shift-planner` only; `shift-viewer` never sees it, nor the date of birth, in any personal-limits read. Audit log stores the change as `{"maternity_protection": "changed"}` (likewise `date_of_birth`) without the value. The plan check names the person but states only "protected-group rule (MuSchG)", never "pregnant".
8. **Warn, don't block, on publish.** Legal findings surface as a warning on Take as Plan and publish, consistent with how swap rule breaches are warnings; the roster guard is unchanged.

## Risks / Trade-offs

- Legal text simplified (e.g. 8→10 h extension requires 6-month average) → document the modelled subset in the spec; not legal advice.
- Hard legal rules can make plans infeasible/short → coverage-first ordering keeps a plan returned, with the shortage named.
- Longer averaging window needs more history than the current 14 days → backend must fetch N weeks of confirmed roster as `history` when the profile is on (larger payload).
- Solver size grows with per-employee window sums → keep the constraints linear and only for employees with hours in range.

## Migration Plan

One additive migration with defaults (`none`, NULLs); existing tenants unchanged. Rollback: drop the columns.

## Open Questions

- Default averaging window: 24 weeks (ArbZG §3) vs 4 months? Assumed 24 weeks, configurable.
- Is a stored date of birth acceptable, or only an `is_minor` flag? Assumed date of birth so minor status updates itself.
- Sunday/holiday rules (§11, 15 free Sundays) assumed report-only in v1.
