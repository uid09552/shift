# Frontend

An Angular 21 single-page application in `ui/`, built on the TailAdmin template
with Tailwind CSS 4. It talks to the backend REST API and, through the chat
widget, to the agent.

## Stack

| Concern | Library |
|---|---|
| Framework | Angular 21 (standalone components) |
| Styling | Tailwind CSS 4 + TailAdmin |
| Components | Angular Material |
| Calendars | FullCalendar 6 (daygrid, timegrid, interaction) |
| Charts | ApexCharts, AMCharts 5 |
| Reactivity | RxJS 7 |

## Design system

[`Design.md`](../Design.md) is mandatory for every screen; CLAUDE.md lists the
rules. The tokens are in `ui/src/styles.css`: the brand scale is SAP Blue
(`brand-500` #0057d2, `brand-600` #0040b0), the light theme's gray scale is
Design.md's slate text ladder and chrome/band surfaces, every `shadow-*` is
none, corners are 4 / 8 / 12px, `font-mono` is Inter, and letter-spacing is 0.
Typography roles and bands are utilities (`type-*`, `band-neutral`,
`band-blue`).

`npm run lint:design` (`ui/scripts/design-lint.mjs`, also run before every
`npm run build`, so the image build in CI) fails on shadows, letter-spacing,
pill-shaped text, the old brand colour and a second font family. A line may opt
out with `design-lint-ignore` and a reason.

## Routes

All application routes render inside `AppLayoutComponent` (sidebar + header):

| Path | Page |
|---|---|
| `/` | Dashboard |
| `/kalender` | Schedule: Day, Week (default) or Month — `?view=day\|month` opens one, `?month=YYYY-MM` a month, `?date=YYYY-MM-DD` a day, `?replace=<employee>&on=<date>` the replacement dialog. Filters and saved views in the toolbar; without one of these parameters it opens the user's default (or last-used) view |
| `/day-view` | Redirects to `/kalender?view=day` |
| `/employee-calendar` | Per-employee calendar |
| `/workstation-calendar` | Redirects to `/kalender` — the schedule page reads by workstation itself |
| `/scheduler` | Optimization workbench, in tabs — `?tab=calculate\|check\|compare\|runs` opens one (no `tab` = Proposal) |
| `/rotations` | Rotation patterns: write a cycle, preview and apply it as fixed assignments |
| `/fairness` | Nights, weekends, hours vs target and wishes per employee, from the confirmed roster |
| `/ontology` | Reports › Ontology: d3 network of employees, capabilities, workstations and shifts, optionally with a day's or week's roster. Planners and admins (`writerGuard`); lazy-loaded, the only page with d3. The former address `/relationships` redirects here |
| `/analytics` | Reports › Analytics: ECharts report over the confirmed roster, change notices, audit activity and planning runs, one filter bar and cross-filtering, state in the query string. Planners and admins (`writerGuard`); lazy-loaded, the only page with ECharts |
| `/user-profiles` | Employee profiles |
| `/shifts` | Shift configuration |
| `/workstations` | Workstation configuration |
| `/capabilities` | Capability configuration |
| `/planner-settings` | Solver settings |
| `/wish-settings` | Shift-wish window (visible to all, editable by `shift-admin`) |
| `/users` | Organization members and their roles (`shift-admin` only) |
| `/audit-log` | Who changed what, with a field-by-field diff per entry |
| `/scenarios` | Planner › What-if scenarios: overrides (absences, closures, hires, minimums), run, results with "compare with a proposal" (`/scheduler?tab=compare&b=<id>`) (`writerGuard`) |
| `/forecast` | Reports › Capacity forecast: available vs required hours per month, per capability (`writerGuard`) |
| `/setup` | First-run setup guide: six steps with links, sample data for an empty organization (`adminGuard`; also in the user menu) |
| `/signin`, `/signup` | Auth pages (standalone, outside the layout) |
| `**` | Not found |

When adding a page, add it to `app.routes.ts`, to the sidebar in
`shared/layout/app-sidebar/`, to both dictionaries in `shared/i18n/` (`en.ts`
and `de.ts`), **and** to `KNOWN_PAGES` in `agent/shift_agent/mcp/server.py` —
otherwise the chat agent cannot navigate there.

## Source layout

```
ui/src/app/
├── app.routes.ts
├── pages/
│   ├── dashboard/          landing dashboard
│   ├── planner/            kalender, day-view, employee-calendar, rotations,
│   │                       scheduler, fairness, user-profiles
│   ├── reports/            ontology (d3 network), analytics (ECharts report); both read-only
│   ├── configuration/      shifts, workstations, capabilities, planner-settings,
│   │                       wish-settings, users, audit-log
│   └── auth-pages/         sign-in, sign-up
└── shared/
    ├── services/           one HTTP service per API resource
    ├── components/         reusable UI
    ├── i18n/               en.ts, de.ts — every visible string, by key
    └── layout/             app shell
```

## Services

One service per backend resource, in `ui/src/app/shared/services/`:

| Service | Backing endpoints |
|---|---|
| `employee.service.ts` | `/employees` and its sub-resources |
| `shift.service.ts` | `/shifts`, weekday times |
| `capability.service.ts` | `/capabilities` |
| `workstation.service.ts` | `/workstations` |
| `workstation-unavailability.service.ts` | workstation closures |
| `unavailability.service.ts` | `/unavailabilities` |
| `planner.service.ts` | `/planner/*` — trigger, poll, results |
| `planner-settings.service.ts` | `/planner-settings` |
| `shift-wish.service.ts` | `/shift-wishes` |
| `shift-swap.service.ts` | `/shift-swaps` — list, request, accept/decline/cancel/approve/reject, pending count |
| `swap-notification.service.ts` | Polls `/shift-swaps/pending-count` every minute for the header bell — planners and admins only |
| `leave.service.ts` | `/leave-requests`, `/leave-blackouts`, `/leave-limits` — plus `leaveDays()` |
| `open-shift.service.ts` | `/open-shifts` — list, count, gaps, offer, volunteer/withdraw, assign, close |
| `notification-preferences.service.ts` | `/notification-preferences` — the caller's own e-mail choices |
| `calendar-feed.service.ts` | `/calendar-feed` — make, replace, remove the caller's iCal link; `feedUrls()` |
| `staffing-rules.service.ts` | `/skill-mix-rules`, `/pairing-rules` |
| `saved-view.service.ts` | `/saved-views` — the caller's views of a page, default and last-used view |
| `demand.service.ts` | `/workstation-demand`, `/workstations/{id}/demand` — headcount by hour |
| `call-in.service.ts` | `/call-ins` — minutes called in on on-call duties |
| `forecast.service.ts` | `/analysis/capacity-forecast` |
| `setup.service.ts` | `/setup-status`, `/setup/sample-data`; whether the overview banner was hidden (local, per browser) |
| `availability-rules.service.ts` | Standing availability, held capabilities' expiry, `/capability-expiries` |
| `wish-settings.service.ts` | `/wish-settings` — plus `wishAllowedOn()`, the client-side mirror of the window check |
| `confirmed-shift-plan.service.ts` | `/confirmed-shift-plans` |
| `rotation.service.ts` | `/rotation-patterns`, `/rotation-patterns/{id}/apply` |
| `analysis.service.ts` | `/analysis/*`, including `/analysis/fairness` |
| `audit-log.service.ts` | `/audit-logs` |
| `plan-validation.service.ts` | the agent's `/agent/plan/validate` and `/agent/plan/fix` |
| `organization-user.service.ts` | `/users`, `/users/{id}/roles` |
| `info.service.ts` | `/info` — the version shown under the sidebar |
| `user.service.ts` | `/self` — identity and `roles`, via `isAdmin()` / `canPlan()` |
| `chat.service.ts` | the agent's `/api/v1/chat` |
| `modal.service.ts`, `sidebar.service.ts`, `theme.service.ts`, `global-search.service.ts` | UI state |

## Development

```bash
cd ui
npm install
npm start          # ng serve on :4200
npm run build      # production build to dist/
```

`ui/proxy.conf.json` proxies `/api` to the backend, so the dev server needs no
CORS setup. `make serve` in `ui/` runs `ng serve --host 0.0.0.0 --port 4200` if
you need it reachable from outside the machine.

From the repository root, `make ui-serve` does the same.

### The `vite` override

`ui/package.json` pins `vite` to 8.3.3 through npm `overrides`. `@angular/build`
22.2.4 depends on exactly `vite@8.3.0`, which has dev-server vulnerabilities
fixed in 8.3.3 (Dependabot alerts #70–72 and #122–124: files outside
`server.fs.allow`, the `?vite-wasm-instance` leak, and three launch-editor issues
on Windows). Production is unaffected either way, since it ships static files.

**Remove the override** once an `@angular/build` release depends on
`vite` ≥ 8.3.3. Until then, `npm ls vite` shows `vite@8.3.3 overridden`. Left in
place after that, it would hold `vite` back.

## The scheduler page

`/scheduler` is where the optimizer is driven, in five tabs: **Calculate**,
**Proposal**, **Check & fix**, **Compare** and **Runs**. The active tab lives in
the `tab` query parameter, so reloads and shared links keep it.

- **Calculate** triggers a run, then polls `/planner/plan/{task_id}/status`
  until it settles. Above the button, the coverage check compares demand per
  shift and day with the staff who could take it, before anything is solved.
- **Proposal** renders the returned plan by workstation or by employee, allows
  hand edits (employee view, right-click), and offers *Take as Plan*, which
  promotes the result into `confirmed_shift_plans`; the calendars and dashboard
  pick it up from there.
- **Check & fix** posts the result id to the agent's `POST /agent/plan/validate`
  (see [Agent](agent.md)), which re-checks the proposal against the rules it was
  solved under and returns the findings with a short written review. The check
  is read-only. *Fix Plan* posts to `POST /agent/plan/fix`, which **does** save:
  the repaired plan replaces the proposal being viewed.
- **Compare** puts two stored runs side by side, scored against the current
  setup.
- **Runs** lists every stored proposal and the task queue behind them.

## Shift swaps on the Schedule page

Who you are decides what the swap tools do (`UserService.canPlan()`, and the
employee matched to your e-mail):

- **Employees** get *Request a swap…* in the menu of their own shift (today or
  later). They then click the colleague's shift they would take instead —
  the same pick-a-cell gesture as the planner's *Swap with…* — and confirm.
  Nothing in the grid changes; a request is sent.
- **Swap requests** in the toolbar opens `SwapRequestsDialogComponent`. An
  employee sees what is asked of them (accept / decline) and their own requests
  (withdraw while pending). A planner sees what both colleagues agreed to;
  *Review* loads the request with the agent's rule warnings, and *Approve* /
  *Reject* decide. Approval reloads the grid.
- **The header bell** shows a count and an entry linking to
  `/kalender?swaps=open` for planners and admins only, polled every minute by
  `SwapNotificationService`.

## Leave, open shifts and notifications

Three pages under *Planner* (the last under *Configuration*), each different for
employees and planners (`UserService.canPlan()`):

- **Leave** (`/leave`, `LeaveComponent`). An employee sends a request (the form
  shows a blackout period before the server refuses, and the limit warnings that
  come back) and sees their own with what became of them. A planner gets tabs:
  *Requests* (the queue with limit warnings, an optional comment, *Approve* /
  *Reject*; approved leave that has not ended can be *Revoked*), *Year overview*
  (days per person and month, approved and pending, filterable by capability,
  with the most people away on one day per month underneath) and *Rules*
  (blackout periods and per-capability limits).
- **Open shifts** (`/open-shifts`, `OpenShiftsComponent`). An employee sees each
  slot and whether they may take it — with every reason when they may not — and
  volunteers or withdraws. A planner offers a slot, finds the gaps below a ward's
  minimum and offers them in one click, sees the volunteers (each with the same
  check) and assigns one, or withdraws the offer.
- **Notifications** (`/notifications`, `NotificationSettingsComponent`). The
  channel and the five events as switches, saved as they are made; a banner says
  when the installation has no mail server. Below it the **calendar
  subscription** (`CalendarFeedCardComponent`): the link is shown once, right
  after it is made, with *Copy* and a `webcal://` *Subscribe*; a lost one is
  replaced, never shown again.
- **Staffing rules** (`/staffing-rules`, `StaffingRulesComponent`, planners and
  admins): skill-mix and pairing rules in words, with forms to add them.
- **An employee's page** (`/user-profiles/:id/edit`) carries *Valid until* per
  saved capability (`CapabilityExpiryCardComponent`, saved as set) and *Standing
  availability* (`AvailabilityRulesCardComponent`). Above the Employees list,
  planners see what lapses within 60 days (`CapabilityExpiryWarningsComponent`).

A change that needs a reason (a published month inside the freeze window, a
locked one) is asked for by `reasonRequiredInterceptor` and retried — approving,
revoking and assigning need no code of their own for it.

## Command palette, saved views, setup guide

- **Command palette** (`shared/components/command-palette/`): Ctrl+K / ⌘K on
  every page, or the search button in the header. People (their calendar),
  workstations, shifts and capabilities (edit page for planners), every page the
  sidebar offers the user's role (`NAV_ITEMS`, `shared/layout/app-sidebar/nav-items.ts`),
  a day (`2026-12-24`, `24.12.`, `tomorrow`, `next Monday`, `nächsten Montag` → the
  Schedule page on it) and quick actions by role: calculate a plan, publish this
  or next month, find a replacement for someone today, add an employee/shift/
  workstation; request leave and my calendar for viewers. A combobox over a
  listbox: arrows, Enter, Escape (focus returns). Search and dates are pure
  functions in `palette-search.ts`. The header's text field stays the per-page
  name filter, now on `/`.
- **Saved views** on the Schedule page (`schedule-views.component.ts`,
  `schedule-view-state.ts`): a Filter panel (workstations — whoever is planned
  there in the period; capabilities — whoever holds one; people) and a Views menu
  (apply, star as default, save as…, save changes, share for planners, delete).
- **Setup guide** (`pages/configuration/setup/`): the checklist from
  `/setup-status`; the overview shows admins a banner while it is incomplete
  (`setup-banner.component.ts`), which they can hide; the user menu reopens it.

## Accessibility

WCAG 2.1 AA is the target. What holds it in place:

- `FocusTrapDirective` (`shared/a11y/`) on every dialog — the modal, confirm and
  reason dialogs: focus moves in, Tab wraps, focus returns on close; Escape
  closes the topmost one. Dropdowns close on Escape and refocus their toggle.
- A skip link to `<main id="main-content">`; icon-only buttons carry an
  `aria-label`; the Schedule grid is a table with a caption, column headers and
  a row header per person; shift cells show the shift's code in dark text — the
  colour is only the edge.
- `src/app/a11y.spec.ts` runs **axe-core** over Overview, Schedule, Scheduler,
  Employees, Settings, the palette and the dialogs, in the light and the dark
  theme: no critical or serious findings (colour contrast checked on the
  Schedule grid, palette and dialogs). `shared/testing/axe.ts` turns transitions
  off while measuring, or a theme switch is caught halfway.

## The day view

The Schedule page's *Day* view (`/kalender?view=day`; `DayViewComponent`,
embedded with the page's date as input) draws one day as a Gantt chart: employees down the left, a 24-hour
ruler across the top, and each confirmed shift as a coloured bar spanning its
configured hours for that weekday. Bar geometry is kept in hours and multiplied
by a `hourWidth` zoom factor in the template, so zooming rescales without
rebuilding the model. The previous day is fetched alongside the selected one, so
a night shift that crosses midnight is drawn on both days it touches.

## Production build

`deploy/Dockerfile.ui` builds the app and serves `dist/` from nginx using
`deploy/nginx.conf`. In the Compose stack the container is `shift_planner_ui`,
published on port `8888`, and reached through APISIX at `/planner/`.
