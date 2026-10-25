# Design

## Context

- The use cases are constants in `planner-settings.presets.ts`
  (`USE_CASE_TEMPLATES`): each a full set of `PresetValues`, the planner settings
  without the ward-level decisions (solver effort, rotations, personal limits,
  default hours, publish lead, freeze, change weight, labor law).
- `applyTemplate` merges a template's values into the form. The page then
  *derives* the selection: `activeTemplateId` returns the template whose values
  equal the form's, else none, and the page prints "Preset applied" or "custom
  mix". Nothing but the values is saved.
- `PUT /planner-settings` is a full upsert of every column in
  `plannersettingsrepository.rs`. Only the UI writes the settings (the agent's
  tool reads them).
- The audit log records `planner_settings.update` with the new state, and its
  diff view makes field names readable through `plannerSettings.<camelCase>.label`
  keys.
- There is no spec for the settings page; this change starts one for the use
  case only.

## Goals / Non-Goals

**Goals:**
- What was selected is stored, shown, and survives changes to the page's
  templates or fine-tuning.
- The saved values and the saved selection are one write.
- Nothing about planning changes: the optimizer never sees the id.

**Non-Goals:** as in the proposal. In particular the server does not learn the
templates.

## Decisions

### 1. A free-form slug column, not an enum

`planner_settings.use_case varchar(40) NULL`, checked in the service against
`^[a-z0-9_-]{1,40}$`. The templates live in the UI and the set grows there, so a
database `CHECK` or an enum would need a migration for every new use case. The
cost is that the server cannot tell a real use case from a made-up slug; the UI
shows an unknown one as *custom*.

### 2. Keep, clear, set

On `PUT` the field is a three-way value: absent keeps the stored id, `null`
clears it, a string sets it. That is the pattern the employee's weekly hours
already use, and it makes a client that does not know the field harmless (a
cached old UI, a script) instead of silently wiping the choice.

Plain `Option<String>` cannot tell absent from `null`, so the request field is
`Option<Option<String>>` with a small `deserialize_with` that maps an explicit
`null` to `Some(None)`. The existing upsert does not touch the column; when the
field is present the repository then runs `UPDATE planner_settings SET use_case
= $1 WHERE tenant_id = $2` **in the same transaction** as the upsert, so the
values and the id are saved together or not at all. The response and the audit
entry carry the stored value.

### 3. The selection logic becomes pure functions

In `planner-settings.presets.ts`:

```ts
differingSettings(template, form): number   // settings that differ, priority counted once
resolveUseCase(stored, form): { template: UseCaseTemplate | null; changed: number }
```

`resolveUseCase` returns the stored template when the id is known, otherwise
(null, or an id the UI has not got) the template whose values equal the form's,
if any. `changed` is 0 for the derived case, by definition. Both are unit-tested
without Angular.

The component keeps `form.use_case`:
- on load it is `stored`, or, when nothing is stored, the exactly matching
  template's id (so the match is stored on the next save), or `null`;
- an id the UI does not know is left as it is, shown as custom, and sent back
  unchanged;
- `applyTemplate` writes the values and sets `form.use_case`;
- `clearUseCase()` sets it to `null`.

Nothing is saved until the page's existing *Save*; the unsaved-change tracking
treats `use_case` like any other field.

### 4. What the page says

The status line under the cards has three states, replacing `templateActive` /
`customActive`:

| state | text |
|---|---|
| a use case, values equal | *Use case: Equal share* |
| a use case, values differ | *Based on Equal share · 3 settings changed* |
| none | *Custom settings* |

The selected card is marked from `resolveUseCase`, not from a value match, so it
stays marked while the planner fine-tunes. A *Clear selection* link appears
while a use case is selected. Strings go in `de.ts` / `en.ts` with a plural for
the count.

### 5. Audit and API consumers

The audit diff labels the new field through `plannerSettings.useCase.label`
("Use case"); values show as their ids, which are readable words. The agent's
settings tool and `GET /planner-settings` return the field with the rest, so the
chat assistant can say which use case a ward has without any agent change.

### 6. Alongside `auto-plan-schedule`

Both changes add planner-settings columns, a migration and a page section. The
migration here is named `…_planner_use_case` and takes the next free number when
it is applied; whichever change is applied second picks the number after the
first. `PresetValues` omits the settings a use case must not change, and each
change adds its new fields to that list (`use_case` here, the `auto_plan_*`
fields there), or the templates would have to carry them. The page edits are in
different sections and merge mechanically.

## Risks / Trade-offs

- [The stored id can disagree with the values (an API client set the values
  only)] → The page compares values for the "changed" count, so it is always
  accurate about the difference.
- [A release changes a template's numbers] → Wards that stored it show *based on
  X, N settings changed*, which is true, instead of a silent mismatch.
- [A planner switches use case and forgets to save] → Same as every setting on
  the page today; the selection is part of the unsaved changes.
- [Clearing the selection while the values still equal a template] → The page
  shows *custom* for that visit, but a tenant with nothing stored has an exact
  match derived on the next load (the rule that keeps tenants from before this
  change working), so the template reappears. Honest rather than hidden: it is
  what the values say, and a one-off edit of any value makes *custom* durable.
- [`Option<Option<…>>` is easy to get wrong] → Tested explicitly: omitted,
  `null`, a value, and an invalid one.

## Migration Plan

One additive migration (`ALTER TABLE planner_settings ADD COLUMN use_case
VARCHAR(40)`), no backfill: existing tenants get `NULL`, which the page handles
by deriving an exact match (spec: *Tenants without a stored use case*). The down
migration drops the column. Deploy backend and UI together; an old UI keeps
working against the new backend because an omitted field keeps the stored value.
