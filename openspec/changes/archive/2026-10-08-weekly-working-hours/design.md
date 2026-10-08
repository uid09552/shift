## Context

Today `employees.monthly_working_hours` (`DOUBLE PRECISION NOT NULL DEFAULT 0`, migration 5) is the only contract figure. Four places turn it into a target for some period, each on its own:

- the optimizer: `monthly × num_days / 30` (`planner/shift_planner/optimizer.py`), skipped when 0;
- Fairness: `monthly × days / 30` (`repository/analysisrepository.rs`);
- the agent's plan check (`validation.py`) and replacement ranking (`replacement.py`), from the `employees` in `/planner/prepare`;
- the UI: employee form, Employee calendar.

Planner settings (one row per tenant) already hold a tenant-wide weekly band (`weekly_min_hours`, `weekly_max_hours`, `weekly_hours_target_weight`) and the weight of the contract target (`monthly_hours_target_weight`). The band is a separate soft rule and is not touched here.

## Goals / Non-Goals

**Goals:** weekly contract hours per employee, optional, with a tenant default of 40 h; one proration rule (`weekly × days / 7`) everywhere; existing data converted without anyone's target silently changing, except employees who never had one.

**Non-Goals:** different hours in different weeks, part-time patterns; changing the weekly band or the weights; a dual monthly/weekly transition period.

## Decisions

- **Storage.** `employees.weekly_working_hours DOUBLE PRECISION NULL` replaces `monthly_working_hours`. `NULL` = follow the default; `0` = no target (as before); otherwise the own value. `planner_settings.default_weekly_working_hours DOUBLE PRECISION NOT NULL DEFAULT 40`, so the default lives with the other planning settings, is tenant-scoped, readable by every role and writable by planners and admins under the existing middleware rule. *Alternative:* a separate tenant settings table — rejected; planner settings already is that row.
- **Resolution in the backend.** Repositories return the raw nullable value. The employee service and every producer of planner input resolve `effective = own ?? default` once per request (one settings read). Responses carry `weekly_working_hours` (own, nullable) and `effective_weekly_working_hours`. The optimizer input, `/planner/prepare` and Fairness use only the effective value, so the planner and the agent never see `NULL` and never need the default. *Alternative:* resolving in the planner and agent — rejected; it would spread the default to three codebases.
- **Planner contract.** `employees[].monthly_working_hours` becomes `employees[].weekly_working_hours` (number, effective). The planner prorates as `weekly × num_days / 7` and still skips 0. The agent derives a month's target as `weekly × days_in_month / 7`.
- **API writes.** On create, `weekly_working_hours` is optional (absent or `null` → default). On update, an absent key leaves the value unchanged and `null` clears it back to the default. A body with `monthly_working_hours` is refused with 400 naming the new field, so old clients fail loudly rather than lose data. Values must be `0 ≤ h ≤ 168`; the default must be `0 < h ≤ 168`.
- **Import/export.** The template column becomes `weekly_working_hours`; an empty cell means the default. A file with the old `monthly_working_hours` header is refused with a message naming the new column. Export writes the own value (empty when following the default), so a round trip keeps who follows the default.
- **Migration.** Add the column; set it to `round(monthly × 12 / 52 × 2) / 2` where `monthly > 0`, leave `NULL` where `monthly = 0`; drop the old column; add the settings column. The down migration restores `monthly = round(coalesce(weekly, 0) × 52 / 12, 1)`, after which formerly-defaulted employees are back at 0. Rows that follow the default lose that fact on the way down; acceptable for a rollback.
- **Weight name.** `monthly_hours_target_weight` keeps its API name (renaming it would break saved settings and presets for no gain); the UI labels it as the weight of the contract hours target.
- **UI.** The employee form's hours field is empty-able, with the tenant default as placeholder ("Default: 40 h") and a reset to default; the list shows the effective value and marks defaulted ones. Planner Settings gets the default next to the weekly band. Employee calendar and Fairness show targets computed by the backend.

## Risks / Trade-offs

- **Employees at 0 gain a 40 h target** after the migration. That is the intent (they were never set), but a ward that used 0 to mean "no target" would see it change: they set 0 again explicitly. Called out in the migration's comment and the docs.
- **Rounding** on conversion (e.g. 160 → 37.0 instead of 36.92): small, and planners can edit.
- **Changing the default** re-targets many people at once; the audit entry for `planner_settings.update` records it.
- **Breaking API change** for scripts that write `monthly_working_hours`: explicit 400 and OpenAPI update; `seed_data_v2.py` updated with it.

## Migration Plan

One migration, applied at backend start as today. Deploy backend, planner and agent together (the planner input field is renamed). Rollback: down migration, then the previous images.

## Open Questions

None blocking. Whether Fairness should flag "follows default" separately is left to the UI task.
