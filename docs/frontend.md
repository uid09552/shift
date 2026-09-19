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

## Routes

All application routes render inside `AppLayoutComponent` (sidebar + header):

| Path | Page |
|---|---|
| `/` | Dashboard |
| `/kalender` | Schedule: Day, Week (default) or Month — `?view=day\|month` opens one |
| `/day-view` | Redirects to `/kalender?view=day` |
| `/employee-calendar` | Per-employee calendar |
| `/workstation-calendar` | Redirects to `/kalender` — the schedule page reads by workstation itself |
| `/scheduler` | Optimization workbench, in tabs — `?tab=calculate\|check\|compare\|runs` opens one (no `tab` = Proposal) |
| `/rotations` | Rotation patterns: write a cycle, preview and apply it as fixed assignments |
| `/fairness` | Nights, weekends, hours vs target and wishes per employee, from the confirmed roster |
| `/user-profiles` | Employee profiles |
| `/shifts` | Shift configuration |
| `/workstations` | Workstation configuration |
| `/capabilities` | Capability configuration |
| `/planner-settings` | Solver settings |
| `/wish-settings` | Shift-wish window (visible to all, editable by `shift-admin`) |
| `/users` | Organization members and their roles (`shift-admin` only) |
| `/audit-log` | Who changed what, with a field-by-field diff per entry |
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
| `wish-settings.service.ts` | `/wish-settings` — plus `wishAllowedOn()`, the client-side mirror of the window check |
| `confirmed-shift-plan.service.ts` | `/confirmed-shift-plans` |
| `rotation.service.ts` | `/rotation-patterns`, `/rotation-patterns/{id}/apply` |
| `analysis.service.ts` | `/analysis/*`, including `/analysis/fairness` |
| `audit-log.service.ts` | `/audit-logs` |
| `plan-validation.service.ts` | the agent's `/agent/plan/validate` and `/agent/plan/fix` |
| `organization-user.service.ts` | `/users`, `/users/{id}/roles` |
| `info.service.ts` | `/info` — the version shown under the sidebar |
| `user.service.ts` | `/self` — identity and `roles`, via `isAdmin()` / `isPlanner()` |
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
