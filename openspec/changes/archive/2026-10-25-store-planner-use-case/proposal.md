# Proposal

## Why

The planner settings page offers *use cases* (Balanced, Equal share, Wishes
first, Coverage first, Stable rosters, Staff wellbeing). Picking one fills in
about twenty values, and only those values are saved. The choice itself is
forgotten: the page guesses it again on every visit by comparing the saved
numbers with each template. Fine-tune one value and the page calls the setup
"a custom mix" with no trace of what it started from; reload after changing a
template's numbers in a release and the guess is wrong. Nobody, including the
audit log and the chat assistant, can tell which use case a ward chose.

## What Changes

- **The selected use case is stored** with the planner settings, as its id
  (`balanced`, `fairness`, …) or none. It is saved in the same request as the
  values it filled in, so the two cannot disagree about what was saved.
- **The page shows what was selected**, from the stored value, not from a
  comparison: the card is marked, and a line says either *Use case: Equal
  share* or *Based on Equal share, 3 settings changed*. Fine-tuning no longer
  turns the selection into an anonymous "custom mix"; a planner can clear it
  to mean "custom".
- **Existing tenants start with nothing stored.** The page falls back to
  today's comparison for them, so a ward that matches a template exactly still
  sees it, and that match is stored the next time they save.
- **The audit log shows it**: a change of use case appears as a `Use case`
  field in the settings diff, and the API and the chat assistant read it with
  the other settings.

Non-goals:

- The use cases stay what they are: sets of weights defined in the UI. The
  server stores a label and does **not** check that the values match the
  template, and templates are not moved to the server.
- Settings a use case never touches stay untouched (solver effort, rotations,
  personal limits, default hours, publish lead, freeze, change weight, labor
  law).
- Showing the selection anywhere but the settings page (the Scheduler, for
  example).

## Capabilities

### New Capabilities
- `planner-use-cases`: A tenant's chosen planner use case: stored with its
  settings, shown as selected (and as modified when fine-tuned), clearable, and
  derived for tenants that never stored one.

### Modified Capabilities
<!-- none: no existing spec covers the planner settings page -->

## Impact

- **Backend:** a nullable `use_case` column on `planner_settings` (new
  migration), carried through the domain, repository, request and response in
  `services/planner_settings.rs`, with validation.
- **API:** `GET/PUT /planner-settings` gain `use_case`, documented in
  `api/openapi.yaml`. On `PUT`, an omitted field keeps the stored value and
  `null` clears it, so a client that predates the field changes nothing.
- **UI:** `planner-settings.component.ts` and `planner-settings.presets.ts`
  (the selection logic moves into pure, tested functions), the settings service
  type, the audit-log field label, translations in `de.ts` / `en.ts`.
- **Data:** additive; every existing row gets `NULL`.
- **Coordination:** the pending `auto-plan-schedule` change also adds planner
  settings columns and a migration, and edits the same page. See the design for
  the ordering.
