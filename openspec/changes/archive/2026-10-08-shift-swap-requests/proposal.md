## Why

Employees who agree to trade shifts today have to ask the planner to edit the confirmed roster by hand. A viewer-initiated swap, agreed by the colleague and confirmed by a planner, removes that back-and-forth while keeping the planner in control of the roster. This is item 8 in `todo.txt` (the swap half; open shifts stay out of scope).

## What Changes

- A `shift-viewer` can request a swap of one of their own confirmed shifts with one of a colleague's confirmed shifts.
- The colleague accepts or declines. Only accepted requests reach the planner.
- A `shift-planner` or `shift-admin` approves or rejects. On approval the two roster rows are exchanged and an audit entry is written.
- Rule checks (rest, recovery, streaks, weekly cap, station maximum, personal limits) run when the planner looks at a request and are shown as warnings only. They never block approval or request creation. Qualification is not validated.
- Pending swaps that need the planner's attention are shown as a notification in the planner UI, visible to `shift-planner` and `shift-admin` only.
- Requests whose shift date has passed expire.

## Capabilities

### New Capabilities
- `shift-swaps`: request, consent, approval and notification of shift swaps in the confirmed roster.

### Modified Capabilities
- `shift-replacement`: expose its rule checks so swap warnings reuse them.

## Impact

New migration and table for swap requests; new backend service, repository, handlers and OpenAPI paths; `shift-viewer` self-service path allow-list in `services/tenant.rs`; agent endpoint to check a swap; Schedule page UI (request, accept, planner review, notification); en/de i18n; audit log; docs and tests.

Out of scope: open shifts / give-away, e-mail or push notification, the optimizer (swaps never feed it), planner override rules beyond approve and reject.
