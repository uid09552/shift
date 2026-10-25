# Design

## Context

- The UI never sees the JWT. The APISIX gateway does the OIDC login and passes the identity to the backend as `X-Userinfo`; the UI reads it from `GET /api/v1/self` (`UserService.getSelf()`: `sub`, `email`, `preferred_username`, `roles`). Logging out is a full-page navigation to `/logout` from `UserDropdownComponent.signOut()`.
- "Own employee" already exists twice in the UI — `my-day.component.ts` and `kalender.component.ts` both do `getSelf()` → `EmployeeService.getEmployeeByEmail(email)` (404 → `null`). The backend's `caller_employee` matches the same way.
- `EmployeeCalendarComponent` keeps `selectedEmployeeId` and mirrors it, with `activeTab`, into the URL (`syncUrl`). `ngOnInit` takes `employeeId` from the query params only if nothing is selected yet. `loadInitialData()` loads all employees in one `forkJoin`.
- The *Add absence* button condition is `selectedEmployeeId && canRecordAbsence` and sits in the header, outside the tab panels; `setTab` clears menus but not absence mode. The absence list is a `<section data-testid="absence-list">` inside the Calendar panel, always rendered.
- `localStorage` is already used directly by `ThemeService`, `TranslationService` and `ChatService`.

## Goals / Non-Goals

**Goals:**
- Initial employee: URL → remembered choice of this account → own employee → none, with "new login" resetting to own employee.
- Absence button and mode bound to the Calendar section; list collapsed by default.

**Non-Goals:**
- No server-side preference storage; the choice is per browser.
- No detection of a session that merely expired and was renewed by the gateway without a logout — see Risks.
- The month shown and the open/closed state of the absence list are not remembered.

## Decisions

**1. Store `{ sub, employeeId }` under one key, `employeeCalendar.selection`.**
Keying the value by the account's `sub` makes "another account in this browser" detectable without a separate login marker. Alternative — one key per `sub` (`employeeCalendar.selection.<sub>`): leaves stale entries from every account that ever used the browser and would not reset to self after a new login of the same account. A single entry is overwritten by whoever logs in next, which is exactly the reset rule.
When `/self` has no `sub` (dev mode without gateway) the `sub` is stored as `null` and matches `null`, so remembering still works locally.

**2. "New login" = entry missing or `sub` differs. Logout removes the entry.**
`signOut()` removes `employeeCalendar.selection` before navigating to `/logout`. On the next visit after logging in there is no entry → own employee is chosen and stored. Alternatives: compare `auth_time`/`sid` from the token — not in the userinfo the gateway forwards today, would need gateway and backend changes for little gain; `sessionStorage` as a login marker — a new tab is not a new login, so it would reset too often.

**3. Resolve the initial employee once, after employees and identity are known.**
`ngOnInit` reads the query params first (as today). Then, if no `employeeId` came from the URL, it waits for `getSelf()` (errors → no identity) and the employee list from `loadInitialData()`, and picks:
1. remembered `employeeId` if the entry's `sub` matches and the id is in `employees` — otherwise remove the entry;
2. else `getEmployeeByEmail(self.email)` if there is an e-mail, a 404 or error meaning none;
3. else nothing.
The chosen id is set, stored, written to the URL via `syncUrl()`, and its month and leave entries are loaded. A user who picks someone before resolution finishes wins: the resolver only applies when `selectedEmployeeId` is still empty. A small private helper (`readSelection` / `writeSelection` / `clearSelection` with `try/catch` around `localStorage`) lives in a new `employee-calendar/remembered-selection.ts`, so `user-dropdown` can import `clearSelection` without depending on the component.
Why not a shared "current employee" service: two other pages already do the email lookup inline; consolidating them is a refactor outside this change.

**4. Every selection change writes the entry.**
`onEmployeeChange()` stores `{ sub, employeeId }` (empty choice → removes the entry); a URL `employeeId` is stored the same way once `sub` is known. `sub` is cached on the component from the single `getSelf()` call (it is `shareReplay`ed).

**5. Button inside the Calendar condition; tab change ends absence mode.**
The button condition becomes `selectedEmployeeId && canRecordAbsence && activeTab === 'calendar'`, and `setTab` calls `leaveAbsenceMode()` when leaving Calendar. Hiding only the button would leave a live selection that comes back silently; ending the mode matches the existing "leaving clears the selection" rule.

**6. Native `<details>`/`<summary>` for the list.**
Keyboard and screen-reader behaviour come for free and nothing in the component needs to track open state; the `<summary>` holds the existing `absencesHeading` text with count and a chevron. `data-testid="absence-list"` stays on the wrapper; the summary gets `data-testid="absence-list-toggle"`. Alternative: a component toggle with `@if` — more code, and `@if` would destroy the rows, which the e2e keyword reads.

## Risks / Trade-offs

- [The gateway renews an expired session without the user logging out] → that counts as the same login, so the remembered choice stays. Acceptable: the user did not "log in" from their point of view.
- [Logout through a path other than the dropdown, e.g. Keycloak session ended elsewhere, then another account logs in] → the `sub` comparison still resets to the new account's own employee; the same account keeps its choice.
- [Employee identified by e-mail, two employees sharing one] → the backend's lookup returns one; same behaviour as Schedule and dashboard today.
- [e2e tests that assume an empty picker] → the absences suite selects an employee explicitly, so it is unaffected; its "listed" keyword must open the disclosure first.
