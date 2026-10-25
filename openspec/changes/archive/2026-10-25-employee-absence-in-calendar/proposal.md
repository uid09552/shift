# Proposal

## Why

Recording an absence in the employee calendar takes two screens for one
calendar's worth of dates. The month grid shows the days, but cannot create an
absence; that happens on a separate *Absences* tab with a second, mini calendar,
a three-way type switch that is styled like tabs, and an *Add* button. Planners
pick days they cannot see the shifts on, switch tabs to look, and switch back.
Worse, adding an absence on a day that already has a shift **silently replaces
the shift** (the roster write is an upsert), which the mini calendar, never
showing shifts, cannot warn about.

## What Changes

- **One calendar.** Absences are entered on the month grid itself. A new *Add
  absence* button puts the grid into an absence mode: click the first and the
  last day (a range, one day = click it twice), and a panel beside the grid
  takes over. The mini calendar and the *Absences* tab are gone, so the page
  has two sections, *Calendar* and *Hours*.
- **The type is chosen with toggle boxes**, not tab-like pills: three separate
  boxes, **Unavailable**, **Vacation**, **Sick**, each with its colour and a
  one-line meaning. Exactly one is on, and none is on to begin with, because the
  types do different things (unavailable steers the optimizer; sick and
  vacation mark the roster) and a default would be a quiet wrong guess.
- **The effect is shown before it is applied.** The panel names the dates and
  the number of days, and counts the days that already hold a shift or an
  absence which the new one replaces, read for the whole range even where it
  spans months. Days already marked unavailable are skipped for *Unavailable*
  rather than duplicated.
- **The list of absences stays**, under the calendar instead of on its own tab:
  upcoming and past ranges, each with its delete.
- **Failures are reported properly.** A refusal (a locked month, say) shows the
  server's reason, and the calendar reloads so it shows exactly what was saved;
  the selection stays so the planner can try again.
- **Only planners and admins see the controls.** Today a viewer sees them and
  gets a refusal.
- An old link to `?tab=absences` opens the calendar.

Non-goals:

- Any backend or API change: the same per-day requests are made, with the same
  effect for each type.
- Absences on the Schedule page, several employees at once, half days, and
  changing the type of an existing absence in place (delete and add again).
- Changing the shared date-range picker, which the workstation closure form and
  the scheduler still use.

## Capabilities

### New Capabilities
- `employee-absences`: Recording and listing an employee's absences from the
  employee calendar: selecting days on the month grid, choosing the type, seeing
  the effect, applying, and the list of what has been recorded.

### Modified Capabilities
<!-- none: no existing spec covers the employee calendar's absences -->

## Impact

- **UI only**, in `pages/planner/employee-calendar/`: the *Absences* section and
  its picker state are removed; absence mode, the panel, and the list section
  are added; `employee-calendar.component.{ts,html,css}` and its spec change.
- **New shared pieces:** a `toggle-boxes` UI component (a radio group of boxes),
  and a pure selection helper with unit tests.
- `de.ts` / `en.ts` strings; `e2e/` gets an absence case.
- **No backend, API, data or dependency changes.** `app-date-range-picker` stays
  for its other users.
