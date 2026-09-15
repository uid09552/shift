---
type: Service
title: UI Application
description: The Angular 21 single-page application — routes, one HTTP service per API resource, and the scheduler workbench.
resource: ui/src/app/app.routes.ts
tags: [architecture, angular, frontend]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/frontend.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: ui/src/app/app.routes.ts
    author: human:maxrg
    last_modified: 2026-07-15
---

An Angular 21 SPA in `ui/`, built on the TailAdmin template with Tailwind CSS 4.
It talks to the backend REST API and, through the chat widget, to the agent.

# Stack

| Concern | Library |
|---|---|
| Framework | Angular 21, standalone components |
| Styling | Tailwind CSS 4 + TailAdmin |
| Components | Angular Material |
| Calendars | FullCalendar 6 (daygrid, timegrid, interaction) |
| Charts | ApexCharts, AMCharts 5 |
| Reactivity | RxJS 7 |

# Routes

All application routes render inside `AppLayoutComponent` (sidebar + header).

| Path | Page |
|---|---|
| `/` | Dashboard |
| `/kalender` | Weekly schedule — readable by employee, by workstation or by shift |
| `/day-view` | Redirects to `/kalender?view=day` — the Schedule page's Day view |
| `/employee-calendar` | Per-employee calendar |
| `/workstation-calendar` | Redirects to `/kalender`; the standalone per-workstation calendar was removed as a duplicate of its "By workstation" lens |
| `/scheduler` | Optimization workbench |
| `/user-profiles` | Employee profiles |
| `/shifts` | Shift configuration |
| `/workstations` | Workstation configuration |
| `/capabilities` | Capability configuration |
| `/planner-settings` | Solver settings |
| `/wish-settings` | Shift-wish window |
| `/users` | Organization users and roles (`shift-admin`) |
| `/signin`, `/signup` | Auth pages, outside the layout |
| `**` | Not found |

**Adding a page requires two edits.** Add it to `ui/src/app/app.routes.ts` *and*
to `KNOWN_PAGES` in `agent/shift_agent/mcp/server.py` — otherwise the chat
assistant cannot navigate there. See
[Agent and MCP service](/architecture/agent-and-mcp-service.md).

# Source layout

```
ui/src/app/
├── app.routes.ts
├── pages/
│   ├── dashboard/          landing dashboard
│   ├── planner/            kalender, day-view, employee-calendar,
│   │                       scheduler, user-profiles
│   ├── configuration/      shifts, workstations, capabilities, planner-settings,
│   │                       wish-settings, users
│   └── auth-pages/         sign-in, sign-up
└── shared/
    ├── services/           one HTTP service per API resource
    ├── components/         reusable UI
    └── layout/             app shell
```

# Services

One service per backend resource in `ui/src/app/shared/services/`:
`employee`, `shift`, `capability`, `workstation`,
`workstation-unavailability`, `unavailability`, `planner`,
`planner-settings`, `confirmed-shift-plan`, `analysis`, `audit-log`,
`user` (`/self`), and `chat` (the agent's `/api/v1/chat`). Plus UI state
services: `modal`, `sidebar`, `theme`, `global-search`, `context-menu`.

# The scheduler page

`/scheduler` is where the optimizer is driven. It triggers a run, polls
`/planner/plan/{task_id}/status` until it settles, renders the returned plan,
allows hand edits, and offers **Take as Plan** — which promotes the chosen result
into `confirmed_shift_plans`, at which point the calendars and dashboard pick it
up. The user-facing walkthrough is
[Creating a schedule](/guide/creating-a-schedule.md).

# Development and build

```bash
cd ui && npm install && npm start   # ng serve on :4200
npm run build                       # production build to dist/
```

`ui/proxy.conf.json` proxies `/api` to the backend, so the dev server needs no
CORS configuration. `deploy/Dockerfile.ui` builds the app and serves `dist/` from
nginx using `deploy/nginx.conf`; in Compose the container is `shift_planner_ui`
on port 8888, reached through APISIX at `/planner/`.
