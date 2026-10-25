## 1. Shared pieces

- [x] 1.1 Create `shared/components/form/form-page` layout (title, subtitle, content, error summary, sticky Save/Cancel bar with `form-save` / `form-cancel` test ids).
- [x] 1.2 Create `unsavedChangesGuard` (`canDeactivate`, uses `ConfirmDialogService`) and a `writerGuard` / `adminGuard` redirecting to the list.
- [x] 1.3 Add i18n keys (en, de): not-found message, back-to-list, saved toast, discard-changes prompt.

## 2. Capabilities (smallest, proves the pattern)

- [x] 2.1 `CapabilityFormComponent` on `capabilities/new` and `capabilities/:id/edit`, moving the form fields/validation out of the list.
- [x] 2.2 Rewire list: Add, double-click and menu Edit navigate; remove `showForm` and inline form.

## 3. Shifts

- [x] 3.1 `ShiftFormComponent` (name, colour, order, weekday times) on `shifts/new` and `shifts/:id/edit`.
- [x] 3.2 Rewire list and the "import then edit" path to navigate; remove inline form.

## 4. Workstations

- [x] 4.1 `WorkstationFormComponent` on `workstations/new` and `workstations/:id/edit`; it loads capabilities and shifts itself.
- [x] 4.2 Rewire list, import-then-edit and the deactivate dialog trigger; remove inline form.

## 5. Employees

- [x] 5.1 `EmployeeFormComponent` on `user-profiles/new` and `user-profiles/:id/edit`, including capabilities, shifts and personal limits.
- [x] 5.2 Rewire list and import-then-edit; remove inline form.

## 6. Users

- [x] 6.1 `UserFormComponent` on `users/new`, admin-only; keep password/role fields and the `users-form` / `users-form-actions` test ids.
- [x] 6.2 Rewire list; remove inline form.

## 7. Routes, tests, docs

- [x] 7.1 Register all form routes with guards and titles in `app.routes.ts`.
- [x] 7.2 Unit tests: dirty guard, not-found state, save returns to list.
- [ ] 7.3 Update e2e page objects/locators and run `make e2e ARGS="--include smoke"` plus `cd e2e && make dryrun`.
- [ ] 7.4 Manual check at phone width and in dark mode for each form; update CLAUDE.md project structure notes.
