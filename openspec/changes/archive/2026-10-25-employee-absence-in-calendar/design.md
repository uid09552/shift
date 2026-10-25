# Design

## Context

How absences work in `employee-calendar.component` today:

- The page has three sections (`calendar`, `hours`, `absences`) as `app-tabs`;
  the URL carries the choice (`?tab=`), and `isMonthScoped` hides the month
  control on the absences section.
- The *Absences* section holds its own state (`leaveType`, `pickerRange`,
  `pickerResetKey`, `leaveProcessing`, `leaveError`), an `app-date-range-picker`
  fed with `markedDays`, a three-button type switch, an add button, and the list
  of entries (`leaveEntries` folded into `LeaveGroup` ranges, upcoming / past,
  each deletable).
- `applyLeaveRange` creates one request per day: `unavailable` →
  `createUnavailability` (the backend also mirrors it into the roster as a manual
  `unavailable` entry); `day_off` / `sick` → `createConfirmedShiftPlan` with
  `is_present: false`. The roster create is an **upsert** on (tenant, employee,
  date), so it replaces whatever entry the day had, a shift included.
- The month grid (`weeks[].days[]`) already draws all three kinds (shift chips,
  absence chips, an "unavailable" marker) but its cells are busy: an empty cell
  opens a shift menu, a shift chip has hover buttons, a wish chip its own.
- The page does not hide anything from a `shift-viewer`, so the controls are
  shown and the server refuses. `UserService.canPlan()` already answers the
  question for the Schedule page.
- Failures: the page already uses `showSaveError` / `apiErrorMessage` for plan
  and wish actions; the leave actions still use fixed keys.

## Goals / Non-Goals

**Goals:**
- Dates are chosen once, on the calendar that shows the shifts.
- The type control is a clear one-of-three choice with its meaning visible.
- The planner knows what will be replaced before pressing add.
- No new server behaviour.

**Non-Goals:** as in the proposal. The date-range picker is not modified.

## Decisions

### 1. An explicit absence mode, not an always-on selection

The grid's cells already react to clicks (add shift, open day details), so
range selection cannot also be the default click. An *Add absence* button above
the grid sets `absenceMode`; while it is on, each current-month day renders a
full-cell `<button>` (a keyboard-reachable target with an `aria-label` such as
"Select 12 October") over the cell content, and the content's own controls get
`pointer-events: none`. Leaving the mode removes the overlay, so nothing about
normal editing changes.

*Alternatives considered:* drag-to-select (not keyboard-friendly, fights the
cell menus) and Shift-click (hidden, undiscoverable). A mode with a visible
button and panel is explicit and testable.

### 2. Selection is a pure function

`absence-selection.ts`:

```ts
interface Selection { start: string | null; end: string | null }   // YYYY-MM-DD
click(sel, date): Selection      // none → start; start → end (ordered); range → new start
daysOf(sel): string[]            // inclusive, ascending
inSelection(sel, date, hover?): boolean
```

It matches the click behaviour of `app-date-range-picker` (start, end, then
restart), so planners keep the habit. State lives in the component, not the
grid, so changing the month does not lose it, and a range can cross months.
Unit-tested without Angular.

### 3. Toggle boxes as a shared component

`shared/components/ui/toggle-boxes`: a radio group of bordered boxes.

```html
<app-toggle-boxes [options]="absenceTypes" [(value)]="leaveType" [ariaLabel]="…" />
```

Each option has `value`, `label`, `hint` and a `tone` (the colour mark). It
renders `role="radiogroup"` with `role="radio"` boxes, a roving `tabindex`,
arrow keys to move, Space to turn the focused one on. `value` starts `null`.
It is a presentational component, so the Schedule page or planner settings can
use it later.

*Alternative considered:* a `<select>`. Rejected by the choice made for this
change: the meaning of each type should be visible without opening anything.

### 4. The panel

On `lg` and wider it sits to the right of the grid, below it on narrow screens.
It shows, top to bottom: the dates ("Mon 12 Oct – Fri 16 Oct · 5 days", or
"Pick the first and the last day" while nothing is selected), the toggle boxes,
the effect line, a primary button ("Add vacation · 5 days", disabled until a
range and a type exist), and *Cancel*. `Escape` leaves the mode.

### 5. Counting what is replaced

Once a range is complete the component fetches the employee's confirmed entries
for exactly that range (`getEmployeeConfirmedShiftPlans(employee, start, end)`)
and the unavailabilities already loaded, then computes:

- **replaced**: days whose entry is a shift (`is_present`) or an absence other
  than a plain `free` day (a free day is the absence of a plan, not something a
  person entered);
- **skipped** (type Unavailable only): days already in `unavailabilities`.

A fetch, not the grid's own data, because the displayed month is only part of a
range that may cross months. While it loads, the line shows a spinner; if it
fails, the line says the effect could not be read, and adding stays possible
(the server remains the authority).

### 6. Applying

`applyAbsence` builds the day list (minus skipped days) and uses the existing
per-day requests unchanged, but **one after another**, each caught on its own so
a refused day does not stop the rest. Sequential, not parallel as before: the
reason-required interceptor reuses a reason for 20 seconds, but only once it has
been given, so parallel requests into a published month would each ask for it.
A three-week vacation is 21 short requests, which is not noticeable.

- **Success:** end the mode, clear the selection, reload the month's plans (a
  sick or vacation entry changes the grid), refresh `leaveEntries`.
- **Failure (any day):** show `apiErrorMessage(err, …)` in the existing
  `app-error-notice`, **reload** the plans and the list so the page reflects what
  was saved, and keep the mode, the selection and the type. This is the
  `ui-feedback` rule ("a failed action leaves a true picture"), applied to a
  multi-request action where "unchanged" would be false.

### 7. The list moves under the calendar

`leaveEntries`, `upcomingLeave`, `pastLeave`, `leaveRow` and `deleteLeaveGroup`
stay as they are; the markup moves from the removed section to a card under the
grid with a header "Absences (n)". It is not month-scoped and does not change
with the month control. The count that was the tab's badge becomes this header's.

### 8. Removing the section

`Section` and `SECTIONS` lose `'absences'`; `tabItems` loses its entry;
`MONTH_SCOPED` becomes both remaining sections, so the month control always
shows. `ngOnInit` already ignores a `tab` that is not in `SECTIONS`, which is
what opens the calendar for an old `?tab=absences`. `pickerRange`,
`pickerResetKey` and the `markedDays` getter go with the picker. The component
keeps importing nothing for the date-range picker.

### 9. Who sees it

`UserService.canPlan()` sets `canRecordAbsence`; the add button and panel render
only when true. The server's refusal remains the real guard.

## Risks / Trade-offs

- [A mode adds a step: click *Add absence* before choosing days] → It is what
  keeps the grid's existing clicks safe, and the panel it opens carries the rest
  of the flow, so the net is fewer screens, not more.
- [Replacing a shift is still possible] → It was always so (and is right for
  sick leave); the change is that it is now announced, with a count, before it
  happens.
- [A long vacation is many requests] → As before; the batch shares one reason
  prompt and a failure reloads the true state.
- [The overlay buttons duplicate the cell's click target] → Only rendered in the
  mode, over the cell, and unit-tested for keyboard use.
- [Colour alone distinguishes the types] → Each box also carries its text label
  and meaning, and the chips in the grid already carry labels.

## Migration Plan

UI only: nothing to migrate and no data change. A bookmarked `?tab=absences`
lands on the calendar. Rolling back restores the tab.
