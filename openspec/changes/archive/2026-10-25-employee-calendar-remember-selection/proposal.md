# Proposal

## Why

On the employee calendar the *Add absence* button stays in the header when the Hours section is open, where it has nothing to act on, and the list of recorded absences always takes up the space below the grid. Every visit also starts with an empty employee picker, so a planner who looks at the same person all day picks them again each time, and an employee has to find themselves in the list.

## What Changes

- The *Add absence* button is shown only while the Calendar section is open. Switching to Hours ends absence mode (clearing the selection, saving nothing), as Cancel does.
- The list of recorded absences moves into a collapsible disclosure below the grid, closed by default. Its summary keeps the heading with the number of ranges, so the count is visible without opening it.
- The employee calendar remembers the last selected employee in the browser's `localStorage`, together with the account it was chosen by, and preselects it on the next visit.
- Right after a new login — the remembered entry is missing (cleared on logout) or belongs to another account — the calendar preselects the logged-in user's own employee (matched by the e-mail of the token's user info, as the dashboard and the Schedule page already do) and stores it as the new remembered choice. With no matching employee it falls back to the empty picker.
- An `employeeId` in the address still wins over both, so links keep working.

## Capabilities

### New Capabilities
- `employee-calendar`: which employee the employee calendar opens with — address, remembered choice, or the user's own employee after login.

### Modified Capabilities
- `employee-absences`: the add-absence action belongs to the Calendar section only, and the list of absences is collapsed by default.

## Impact

- UI only, no API or database change:
  - `ui/src/app/pages/planner/employee-calendar/employee-calendar.component.{ts,html}` — button condition, tab change ends absence mode, `<details>` around the absence list, initial selection logic.
  - `ui/src/app/shared/components/header/user-dropdown/user-dropdown.component.ts` — clear the remembered selection on logout.
  - `ui/src/app/shared/i18n/{en,de}.ts` — no new keys expected (summary reuses `employeeCalendar.absencesHeading`).
  - Unit tests in `employee-calendar.component.spec.ts`; e2e `e2e/tests/schedule/employee_absences.robot` opens the list before reading it.
