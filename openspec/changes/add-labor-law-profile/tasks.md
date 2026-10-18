## 1. Data model

- [x] 1.1 Migration `00000000000035_labor_law_profile`: `planner_settings.labor_law_profile` (default `none`), `labor_law_averaging_weeks` (default 24); `employee_personal_limits.date_of_birth`, `employee_personal_limits.maternity_protection` (default false); `shifts.break_minutes` (default 0). Regenerate `src/schema.rs`.
- [x] 1.2 Update Rust models, repositories and planner-settings defaults/validation (`models/planner_settings.rs`, personal limits, shift).
- [x] 1.3 Add fields to `api/openapi.yaml`.

## 2. Backend

- [x] 2.1 Role-gate `maternity_protection` and `date_of_birth`: omit for `shift-viewer`; audit-log entries record "changed" without the value.
- [x] 2.2 Map profile, averaging weeks, birth dates, flag and break minutes into optimizer input in `services/optimizer.rs`; fetch N weeks of confirmed roster as `history` when a profile is on.
- [x] 2.3 Tests in `tests/` for settings round-trip, viewer redaction and audit redaction.

## 3. Shared legal rules (Python)

- [x] 3.1 Add `planner/shift_planner/legal.py`: profile → `LegalRules`, per-employee-day resolution (minor/maternity), break requirement, net hours.
- [x] 3.2 Extend `ConstraintConfig`, `Employee`, `Shift` in `models.py`.

## 4. Optimizer

- [x] 4.1 Daily net-hours cap, stricter-of rest, minor and maternity day/night/Sunday exclusions in `optimizer.py`.
- [x] 4.2 Rolling N-week average ≤ 48 h including `history`; weekly cap for minors.
- [x] 4.3 Report unfillable-by-law slots in `message`.
- [x] 4.4 Tests in `planner/tests/`: each rule, tenant-vs-legal stricter, birthday inside period, history in window, short-slot reporting.

## 5. Agent plan check

- [x] 5.1 Add legal checks in `validation.py` using `legal.py`; return `legal` section with statute citations; drop duplicates from soft findings.
- [x] 5.2 Break-definition finding once per shift.
- [x] 5.3 Make `repair.py` treat legal rules as hard when fixing/re-solving.
- [x] 5.4 Tests in `agent/tests/`: compliant, violating, soft-only, profile `none`, no leak of maternity status in text.

## 6. UI

- [x] 6.1 Profile selector and averaging weeks in planner settings.
- [x] 6.2 Date of birth, maternity flag (planner/admin only) on Employees page; break minutes on Shifts page.
- [ ] 6.3 Scheduler "Check & fix": separate "Legal" panel; warning on Take as Plan and publish.
- [x] 6.4 Robot Framework smoke test in `e2e/` for selecting the profile.

## 7. Docs

- [x] 7.1 Update CLAUDE.md/README with the profile, modelled subset of the law and a not-legal-advice note.
