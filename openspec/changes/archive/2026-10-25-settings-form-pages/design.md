## Context

Five components (`shifts`, `workstations`, `capabilities`, `users`, `user-profiles`) each hold a `showForm` flag and render a form card above the table; add/edit state (`editingX`, `formName`, …) lives in the list component. Routes are flat children of the layout in `ui/src/app/app.routes.ts`. Forms use `app-label` / `app-input-field` and `data-testid`s that the Robot Framework page objects rely on.

## Goals / Non-Goals

**Goals:** addressable form pages, same fields and validation, shared layout, unsaved-changes guard.
**Non-Goals:** redesigning fields, changing APIs, rotations editor, dialogs.

## Decisions

1. **Routed pages, not a modal or drawer.** The request is for a "formular", not an overlay; routes also give deep links and Back. Alternative (side drawer) rejected: long forms like Shifts need the width.
2. **One component per form, state moved out of the list.** E.g. `ShiftFormComponent` takes the id from the route, loads the item via the existing service (`getShift`/list fallback), and owns its `form*` fields. The list keeps only listing, import, delete. This shrinks the 700–1100-line list components. Alternative (one generic schema-driven form) rejected: fields differ too much.
3. **Shared `FormPageComponent`** (`shared/components/form/form-page`): breadcrumb, title/subtitle inputs, content slot, error summary, sticky action bar emitting `save`/`cancel`. Keeps layout and button `data-testid`s (`form-save`, `form-cancel`) uniform.
4. **Routes** nested as `shifts/new`, `shifts/:id/edit` etc., with a `canDeactivate` guard (`unsavedChangesGuard`) using the existing `ConfirmDialogService`; each form exposes `isDirty()`.
5. **Return navigation** via `router.navigate(['..'])` plus a one-shot toast; the list reloads on init, so no cross-component state. After "import then edit" flows that call `openEditForm(newItem)` (shifts, workstations, employees) navigate to the edit route instead.
6. **Access** uses the same role check the list uses for its Add button; a route guard redirects non-writers (`users/new`: admin only).
7. **Field `data-testid`s preserved**; add `*-form` ids where missing and update `e2e/resources/pages/*.resource` locators to the new location.

## Risks / Trade-offs

- Large mechanical move of template code → do one screen at a time (capabilities first, smallest) and keep each list working at every step.
- Form components must load data the list previously had in memory (e.g. workstation form needs capabilities and shifts) → each fetches what it needs; accept the extra request.
- Dirty-check false positives → compare against the loaded snapshot, not "touched".
- A confirm on Back gesture varies by browser → rely on Angular's `canDeactivate` only; document that a hard reload uses `beforeunload`.

## Migration Plan

UI-only, shipped at once per screen behind no flag; old inline forms removed in the same step. Rollback is a revert.

## Open Questions

- Assumed "formular" means a full page; a drawer is the alternative if you prefer to keep the list visible.
- Employees page (`user-profiles`) is included though it sits under Planner, because it has the same pattern.
