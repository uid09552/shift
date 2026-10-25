# Tasks

## 1. Shared table utilities

- [x] 1.1 Add the `table-card`, `table-scroll`, `table-base`, `table-head`, `table-th`, `table-tr`, `table-striped`, `table-td`, `table-num`, `table-actions` and `table-empty` `@utility` classes to `ui/src/styles.css`, as in design decision 1; verify that `cd ui && npm run build` succeeds and the classes appear in the built CSS
- [x] 1.2 Apply them to the Capabilities page (the simplest table) as the reference, including the card header moving to `px-5`, and tune zebra, hover and shadow by eye in light and dark mode with 10+ rows; verify that header labels line up with cell text at mobile, `sm` and `xl` widths, and that `ng test` stays green (the page has no component spec of its own)
- [x] 1.3 Add `shared/components/ui/icon-button` (`icon`, `label`, `tone`, `disabled`, `btnClick`, per design decision 7) with its spec covering `aria-label`/`title`, the disabled state emitting nothing, and the click emitting once; use it for the Capabilities row actions; verify that `ng test` passes and the icons render in the light and dark screenshots

## 2. List tables

- [x] 2.1 Restyle Shifts with the shared classes (cells keep their swatch and chip content), with the row actions as `app-icon-button`s in a right-aligned actions column and the card header at `px-5`; verify column alignment and that the shifts specs pass
- [x] 2.2 Restyle Workstations the same way, with deactivate/reactivate as icon buttons keeping `ws-deactivate-*`/`ws-reactivate-*`; verify alignment and that the workstations specs pass
- [x] 2.3 Restyle Employees (`user-profiles`) with icon-button actions: use `table-num` for the hours column and keep the different empty-state padding by using `table-empty`; verify alignment, pagination still working, and that the specs pass
- [x] 2.4 Restyle Users with remove as a `remove-user` icon button (still disabled for yourself), keeping `data-testid="users-table"`, `users-row`, `users-empty` and the loading row; verify alignment and that the users specs pass

## 3. Data tables

- [x] 3.1 Restyle Fairness: `table-num` on the numeric columns, the sort buttons inside `table-th`, the inner `px-2 sm:px-3` on the scroll container removed, and `table-striped` on the body; verify that sorting, `aria-sort` and the `fairness-sort-*` test IDs still work and that the fairness specs pass
- [x] 3.2 Restyle the Audit log with `table-tr` hover but no `table-striped`, keeping the day-group rows, the expansion highlight (`bg-gray-50` when open) and the click-to-expand behaviour; verify that the audit-log specs pass and that an expanded row is still visibly distinct from a hovered one
- [x] 3.3 Grep the seven table templates for leftover `px-4`, `sm:px-6`, `divide-y` and inline header classes; verify that none remain inside the table markup

## 4. Integration check

- [ ] 4.1 Run `cd ui && npm test` and `cd e2e && make dryrun`, then, against a running stack, `make e2e ARGS="--include smoke"`; verify that all of them pass and capture before/after screenshots of Employees and Fairness in both themes for review
