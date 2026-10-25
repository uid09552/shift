# Tasks

## 1. Building blocks

- [x] 1.1 Add `absence-selection.ts` (`click`, `daysOf`, `inSelection`) next to the employee calendar; verify with unit specs: start then end, reversed order, one day by clicking it twice, a third click starting over, a range crossing a month and a year end, and `daysOf` inclusive and ascending
- [x] 1.2 Add `shared/components/ui/toggle-boxes` (options with value, label, hint and tone; `role="radiogroup"` / `radio`; roving tabindex; arrow keys and Space; `value` starts `null`); verify with a component spec: nothing on initially, one on at a time, keyboard selection, `aria-checked`, and that it announces as a radio group

## 2. The calendar

- [x] 2.1 Remove the *Absences* section: drop `'absences'` from `Section` / `SECTIONS` / `tabItems`, make both remaining sections month-scoped, and delete the picker state (`pickerRange`, `pickerResetKey`, `markedDays`) and its markup, keeping `leaveEntries` and its grouping; verify that `?tab=absences` opens the Calendar and that `ng build` passes
- [x] 2.2 Add absence mode to the grid: an *Add absence* button (shown only when `canPlan()` is true and an employee is chosen), per-day select buttons over the current month's cells while the mode is on, the highlight and hover preview, the cells' own controls made inert, selection kept across month changes, and `Escape` / *Cancel* leaving the mode; verify with a component spec that a first and second click select the range, a click in the mode opens no shift menu, the selection survives `nextMonth()`, and a viewer sees no button
- [x] 2.3 Add the absence panel: the dates and day count, the toggle boxes (types Unavailable, Vacation, Sick, with colour and meaning, none on at first), the effect line from design decision 5 (fetching the entries for the range, counting replaced and skipped days, handling a failed fetch), and the add button disabled until a range and a type exist; verify with a component spec that the add button is disabled until both are chosen, that two shifts in the range give "two existing entries replaced", that a range reaching another month is counted, and that an already-unavailable day is listed as skipped for Unavailable only
- [x] 2.4 Implement applying: the existing per-day requests (Unavailable via the unavailability service, skipped days left out; Vacation and Sick as absent roster entries), then end the mode, clear the selection and reload plans and the list; on any failure show the server's reason through `apiErrorMessage`, reload, and keep the mode, selection and type; verify with a component spec that three sick days make three roster requests with `absence_type: 'sick'` and `creation_type: 'manual'`, that Unavailable makes unavailability requests only for unskipped days, and that a refused day shows the reason and reloads while the selection stays
- [x] 2.5 Move the list of absences under the calendar with a header showing the number of ranges, keeping the upcoming / past groups and the confirmed delete; add the strings (`de.ts`, `en.ts`) for the button, the panel, the type meanings, the effect lines and the list header, and `data-testid`s on the button, the cells' select buttons, the panel, the boxes, the add button and the list; verify with a component spec that the list groups upcoming and past, does not change with the month, and that deleting a confirmed range removes its days from the calendar, and that `ng build` passes
- [x] 2.6 Remove the strings and styles only the old section used; verify with a search that no key or class from the removed markup is left and `ng build` passes

## 3. End to end

- [x] 3.1 Add a Robot case under `e2e/tests/schedule/` that opens the employee calendar of a test employee, enters absence mode, picks two days, turns on Sick, adds, sees the sick chips, and deletes the range again through the list (and through the API if the test fails); verify with `cd e2e && make dryrun`

## 4. Integration check

- [x] 4.1 Run `ng test`, `ng build` and `cd e2e && make dryrun`; verify they pass
- [ ] 4.2 Against a running stack: add vacation across a month boundary and see it in both months; add sick over a day with a shift and see the count before and the chip after; try a locked month and see the reason with the selection kept; open `?tab=absences`; sign in as a viewer and find no add-absence button
