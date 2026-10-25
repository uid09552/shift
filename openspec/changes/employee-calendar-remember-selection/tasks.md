# Tasks

## 1. Absence action bound to the Calendar section

- [x] 1.1 In `employee-calendar.component.html` add `activeTab === 'calendar'` to the `absence-mode-button` condition; verify with a spec test that a planner sees the button on Calendar and not on Hours
- [x] 1.2 In `setTab()` call `leaveAbsenceMode()` when switching away from Calendar; verify with a spec test that days selected in absence mode are gone (no `absence-panel`, no highlighted days) after Hours → Calendar and nothing was saved

## 2. Absence list collapsed by default

- [x] 2.1 Wrap the absence list in `<details data-testid="absence-list">` with a `<summary data-testid="absence-list-toggle">` holding the existing `absencesHeading` text (count) and a chevron, closed by default, keyboard-focusable with a visible focus ring; verify the existing list spec test still passes after it opens the disclosure, and a new test that the heading shows the count while no `absence-row` is visible until the summary is clicked
- [x] 2.2 Update `e2e/resources/pages/employee_calendar_page.resource` so `Absence Should Be Listed` opens the list (via `absence-list-toggle`) if it is closed; verify with `cd e2e && make dryrun`

## 3. Remembered employee and own employee after login

- [x] 3.1 Add `ui/src/app/pages/planner/employee-calendar/remembered-selection.ts` with `readSelection()`, `writeSelection(sub, employeeId)` and `clearSelection()` on the key `employeeCalendar.selection` (`{ sub, employeeId }`, every storage access in `try/catch`); verify with a `remembered-selection.spec.ts` covering round trip, malformed JSON and a throwing `localStorage`
- [x] 3.2 In `EmployeeCalendarComponent` resolve the initial employee once employees and `getSelf()` are loaded, if the URL gave none and nothing is selected yet: remembered id (same `sub`, employee exists) → `getEmployeeByEmail(self.email)` → none; drop a stale entry; store, `syncUrl()` and load the month for the result; verify with spec tests for: remembered choice restored, entry from another `sub` replaced by own employee, no entry → own employee, no matching employee → empty picker, deleted employee ignored, a choice made before resolution not overwritten
- [x] 3.3 Write the entry on every selection (`onEmployeeChange`, and a URL `employeeId` once `sub` is known), removing it for the empty option; verify with spec tests that choosing an employee stores it, the empty option removes it, and a URL `employeeId` wins over a remembered one and is stored
- [x] 3.4 In `UserDropdownComponent.signOut()` call `clearSelection()` before navigating to `/logout`; verify with a spec test that sign-out removes the entry

## 4. Integration

- [x] 4.1 Run `cd ui && npx ng test --watch=false` and `npm run build`; both pass
- [ ] 4.2 In the running stack: log in, pick an employee, reload (choice kept), switch to Hours (no absence button), check the list is collapsed, log out and in again (own employee selected)

## Workflow follow-up

- Archive the change after review; `employee-calendar` becomes a new main spec and `employee-absences` takes the modified requirements.
