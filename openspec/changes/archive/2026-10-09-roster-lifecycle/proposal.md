# Proposal

## Why

The confirmed roster has no status today. Anything *Take as Plan* writes is final
and every viewer sees it at once. A planner can rewrite a month that staff have
already arranged their lives around, and nobody is told. A re-plan also ignores
what is already there, so fixing one gap can move half the ward. Hospitals work
with a fixed rhythm instead: the roster is drafted, published a few weeks
ahead, changed only sparingly after that, and closed once the month is over.

## What Changes

- Each calendar month of a tenant's confirmed roster gets a status: `draft` →
  `published` → `locked`. A planner publishes it, and a month whose last day
  has passed locks itself. An admin can unpublish a month (published → draft)
  or unlock it (locked → published), and must give a reason.
- **Draft months are hidden from `shift-viewer`.** Viewers see confirmed rows
  only for published and locked months. **BREAKING** for viewers: until a month
  is published they see nothing for it, while today they see every row at once.
  Existing months are migrated as `published`, so nothing disappears on upgrade.
- **Publish deadline (warning only):** a tenant setting `publish_lead_days`
  (default 28). The Schedule page and dashboard show "October due in 3 days"
  or "overdue" for any month still in draft past `first day − lead days`.
- **Freeze window:** a tenant setting `freeze_days` (default 7). In a published
  month, a change to a day inside the next `freeze_days` days needs a reason.
- **Edit rules by status:** in draft, every roster write works as it does
  today. In a published month, every write (manual edit, *Take as Plan*,
  unavailability, swap approval, replacement) is recorded as a roster change.
  In a locked month only `shift-admin` may write, and must give a reason.
- **Change notices:** every change to a published or locked month creates a
  notice for each affected employee: what it was, what it is now, who changed
  it, and why. An employee sees their own notices ("Changes to my shifts"),
  with an unread count on the header bell, and acknowledges them. Planners see
  every notice and which have not been acknowledged yet.
- **Stable re-planning:** when the planning period overlaps a published month,
  the backend sends that published roster to the optimizer as
  `published_roster`. Right after coverage, the solver minimises the
  employee-days that differ from it, ahead of balance, wishes and fatigue, so a
  re-solve changes as few people as possible (`change_weight` > 0 is on, 0 is
  off). The agent's `resolve` repair gets the same input. Coverage still comes
  first: a change is made when it is the only way to fill a slot.

## Capabilities

### New Capabilities
- `roster-publication`: month status (draft / published / locked) and its
  transitions, publish deadline warning, freeze window, which roles may change
  the roster in each status, and viewer visibility of draft months.
- `roster-change-notices`: tracking every change to a published roster as a
  per-employee notice, plus showing and acknowledging those notices.

### Modified Capabilities
- `shift-optimization`: *Proposal lifecycle* changes because *Take as Plan* now
  respects month status. A new requirement makes re-solving against a
  published roster minimise changes.
- `shift-swaps`: swaps may be requested only on shifts in published months,
  and approving one in a locked month needs `shift-admin` and a reason.

## Impact

- **Database:** new tables `roster_months` (tenant, month, status, published
  at/by, locked at) and `roster_change_notices`. New planner settings columns
  `publish_lead_days`, `freeze_days` and `change_weight`. A migration seeds
  existing months as `published`.
- **Backend:** a roster guard is used by every write path into
  `confirmed_shift_plans`: `services/confirmed_shift_plan.rs`,
  `optimizer::take_as_plan`, `services/unavailability.rs` and
  `repository/shiftswaprepository.rs::approve_swap`. Viewer filtering moves into
  the confirmed plan list endpoints. `build_task_dto` adds `published_roster`.
  New endpoints: `/roster-months` and `/roster-change-notices`.
- **Planner (Python):** a `published_roster` input and a `change_weight`
  constraint in `models.py` and `optimizer.py`, plus tests.
- **Agent:** `resolve` strategy passes `published_roster` through, and plan
  validation reports changes against it.
- **UI:** a month status badge with publish, unpublish and unlock actions on
  the Schedule page, a deadline warning on the dashboard, a reason dialog for
  freeze-window and locked edits, a "Changes to my shifts" list, a notice count
  on the bell, and the new settings on Planner settings.
- **API spec:** `api/openapi.yaml`, plus the CLAUDE.md overview.
- **Out of scope:** email and push notifications, per-workstation status,
  automatic publishing, and time accounts.
