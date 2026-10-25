# Tasks

## 1. Store the selection

- [x] 1.1 Add the migration for `planner_settings.use_case VARCHAR(40) NULL` (up and down), update `src/schema.rs`, and carry the field through the planner-settings domain, models and repository, including the in-transaction `UPDATE` of design decision 2; verify the migration runs on an empty database and reverts, and that `cargo test --test planner_settings --test weekly_hours` still passes
- [x] 1.2 Add `use_case` to the planner-settings response and request (omitted keeps, `null` clears, a string sets, via a `deserialize_with` for the double option) and validate it as 1–40 of `a-z 0-9 - _`; verify with integration tests in `tests/planner_settings.rs`: a new tenant has none, a value round-trips with the values saved in the same request, an omitted field keeps it, `null` clears it, `Equal Share!` and an empty string and 41 characters are 400s that change nothing, a viewer is refused, and the audit entry for the save carries the new id
- [x] 1.3 Document `use_case` and its keep/clear/set behaviour in `api/openapi.yaml`; verify the YAML parses and every `$ref` resolves

## 2. Show it

- [x] 2.1 Add `use_case: string | null` to the settings service type, add it to the `PresetValues` omit list, and write `differingSettings` and `resolveUseCase` in `planner-settings.presets.ts`; verify with unit specs: a stored known id wins over a better-matching template, an unknown id and `null` fall back to an exact match, fine-tuning one weight gives `changed = 1`, the priority weights count once, and nothing matches a mixed form
- [x] 2.2 Rework the use-case section of the planner-settings page: mark the card from `resolveUseCase`, show the three status lines of design decision 4, set `form.use_case` in `applyTemplate`, add *Clear selection*, initialise `form.use_case` as designed (stored, else exact match, else none, unknown ids kept), include it in the saved payload and the unsaved-change tracking, add the strings to `de.ts` / `en.ts` (with the `plannerSettings.useCase.label` audit label), and add `data-testid`s; verify with a component spec that picking saves the id with the values, that fine-tuning keeps the card marked and shows the count, that clearing saves `null`, that a never-stored tenant on the Balanced values shows and then stores it, and that an unknown stored id shows custom and is sent back unchanged; `ng build` passes
- [x] 2.3 Add a Robot case under `e2e/tests/settings/` that picks a use case, saves, reloads and finds it still selected, changes one value and finds "settings changed", then restores the selection it found; verify with `cd e2e && make dryrun`

## 3. Integration check

- [x] 3.1 Run `cargo test --test planner_settings --test weekly_hours --test spreadsheet_import` against a database, `ng test` and `ng build`, and `cd e2e && make dryrun`; verify that they pass
- [ ] 3.2 Against a running stack: pick Staff wellbeing, save, reload and see it selected; fine-tune a value and see the count; clear the selection and see custom; confirm the audit log shows the use case change under "Use case"
