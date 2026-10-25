# Tasks

## 1. Remove the demo auth pages

- [x] 1.1 Delete `pages/auth-pages/`, `shared/components/auth/` and `shared/layout/auth-page-layout/`; drop the `/signin` and `/signup` routes from `app.routes.ts`, `othersItems` and its two uses from `app-sidebar.component.ts`, `HIDDEN_ON` with the `hidden` flag and its router subscription from `chat-widget.component.ts`, and the `nav.authentication` / `nav.signIn` / `nav.signUp` / `title.signIn` / `title.signUp` keys (plus any keys used only by the deleted forms) from `de.ts` and `en.ts`; verify that `grep -rn "signin\|signup\|SignIn\|SignUp" ui/src/app` finds nothing, `ng build` passes, and `ng test` stays green

## 2. Shared pieces

- [x] 2.1 Add `shared/http/api-error.ts` with `apiErrorMessage(err, fallbackKey, t)` (server `error` string → that; status 0 → `common.offline`; else the fallback) and its spec covering the three cases plus a non-HTTP error; verify that `ng test` passes
- [x] 2.2 Add `<app-load-error>` (message, `retry` output, `role="alert"`, `data-testid="load-error"`) and `<app-error-notice>` (message or null, `dismiss` output, `role="alert"`, `data-testid="error-notice"`) in `shared/components/ui/`, each with a spec (renders nothing for null, retry/dismiss emit once); add the new `common.*` i18n keys from design decision 6 in de/en; verify that `ng test` passes

## 3. Lists: Shifts, Capabilities, Workstations, Employees

- [x] 3.1 Shifts and Capabilities: add `loadError` / `actionError`, render `<app-load-error>` in the table body before the empty state, `<app-error-notice>` under the card header, and set `actionError` via `apiErrorMessage` on template download, import and delete failures (cleared on the next success); add `shifts.loadFailed` / `capabilities.loadFailed`; verify that `ng build` and `ng test` pass, with a component spec per page in which the service fails and the page shows `<app-load-error>` (not the empty state) and, on a failed delete, the error notice with the server's reason (the live check with a stopped backend is part of 5.1)
- [x] 3.2 Workstations (list and form): the same for list load, download, import, delete and reactivate; the details/closures loads report into the same notice; the form's unavailabilities load shows `<app-load-error>` in its section; verify as in 3.1
- [x] 3.3 Employees (`user-profiles`): the same for list load, delete, download and import, with the pagination footer hidden while `loadError` is set; verify as in 3.1

## 4. Calendars and Scheduler

- [x] 4.1 Kalender: `loadPlans` / `loadWishes` set `loadError` instead of clearing `planMap`, the grid area shows `<app-load-error>` (Retry → `loadPeriod()`), `confirmDelete` failures call `showSaveError`, `showSaveError` uses `apiErrorMessage`, and the inline `saveError` banner becomes `<app-error-notice>`; verify with a component spec (real services, fake backend) that a failed roster load shows the load error, Retry reloads it, and a refused delete leaves the cell and shows the server's reason (live check in 5.1)
- [x] 4.2 Employee calendar: the confirmed-plans load shows `<app-load-error>` (and the base-data error gets Retry), a failed wish-settings load shows the error notice (design decision 2); wish create/delete and plan delete failures call `showSaveError`; the banner becomes `<app-error-notice>`; verify with a component spec that a refused wish shows the server's reason and adds nothing, and a failed roster load shows the load error (live check in 5.1)
- [x] 4.3 Scheduler: the four page-data loads (results, employees, shifts/workstations, task list) set one `loadError`, shown at the top with Retry reloading all four; verify `ng build` / `ng test` and a component spec in which a failed load shows the error, not empty lists (live check in 5.1)
- [x] 4.4 Audit log and Fairness: replace their bare `<p role="alert">` load messages with `<app-load-error>` (Retry → their existing load); verify that the existing `audit-diff` / `fairness-stats` specs and `ng test` pass

## 5. Integration check

- [ ] 5.1 Run `ng test`, `ng build` and `cd e2e && make dryrun`; with the stack up, run `make e2e ARGS="--include smoke"`, then stop the backend and walk Shifts, Capabilities, Workstations, Employees, Schedule, Employee calendar and Scheduler, confirming each shows a load error with Retry and recovers after the backend is restarted
