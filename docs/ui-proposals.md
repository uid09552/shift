# UI Proposals

What a shift planner of this kind usually offers, what this one already has, and
what is worth building next — with what each proposal would cost, in terms of
this codebase rather than in the abstract.

Nothing here is implemented. It is a menu, ordered so that the cheap, high-value
things come first.

## What exists today

| Area | Covered by |
|---|---|
| Overview | Dashboard — today's coverage, understaffed workstations, recent activity, *My Day* |
| The roster | Schedule (`/kalender`), week or month, read by employee / workstation / shift, editable, Excel export |
| One day in detail | Day View (`/day-view`) — hour-by-hour Gantt of who is on the ward |
| One person in detail | Employee Calendar (`/employee-calendar`) — month, wishes, absences, hours summary |
| Planning | Schedule Optimizer (`/scheduler`), in tabs: **Calculate** (with the coverage check), **Proposal** (hand edits, *Take as Plan*), **Check & fix**, **Compare**, **Runs** |
| Fairness | Fairness (`/fairness`) — per person over a period: shifts, hours against target, nights, weekends, wishes, absences; sortable |
| Rotations | Rotations (`/rotations`) — rhythms like *early, early, late, late, night, off, off, off*, checked against the planner's rules, applied to people with a stagger and a preview; the planner keeps them first |
| Audit log | Audit log (`/audit-log`) — every change, filtered by who, what, item and date; an entry opens onto what it changed against the item's previous version, a deletion onto the name and last state of what was deleted; filters live in the URL, so one item's history is a link |
| Configuration | Shifts, workstations, capabilities, employees, planner settings, wish window, users & roles |
| Assistant | Chat widget over the whole API, roster file import, plan check and repair |

Read against what wards expect from a rostering product, the gaps are not in
*planning* — that part is unusually strong — but in everything **around** a
finished roster: requesting and approving absence, trading shifts, watching hours
balances, publishing changes to the people affected, and proving compliance after
the fact.

## The menu

Effort is rough: **S** = a view over data that already exists, **M** = a new
endpoint or two, **L** = new tables and a workflow.

| # | Proposal | Answers | Needs | Effort |
|---|---|---|---|---|
| 1 | [Hours account](#1-hours-account-zeitkonto) | "Am I over or under my contract?" | One analysis endpoint | S |
| 2 | [Compliance view over the confirmed roster](#2-compliance-over-the-confirmed-roster) | "Does the roster we are actually working break any rule?" | Validate a date range, not just a proposal | M |
| 3 | [Absence requests and approval](#3-absence-requests-and-approval) | "Can I have the 12th off?" | Status + approver on `unavailabilities`, entitlements | L |
| 4 | [Publish and notify](#4-publish-and-notify) | "Who needs to be told their shift moved?" | Plan versions + a notification channel | L |
| 5 | [Shift swaps and open shifts](#5-shift-swaps-and-open-shifts) | "Will anyone take my Saturday?" | An offers table and a workflow | L |
| 6 | [Qualification matrix and expiry](#6-qualification-matrix-and-expiry) | "Whose certificate runs out in March?" | Matrix is free; expiry needs a column | S → M |
| 7 | [Self-service roster feed](#7-self-service-roster-feed) | "My shifts, in my phone's calendar" | A signed ICS endpoint | M |

---

### 1. Hours account (Zeitkonto)

The single most-asked question in a ward, and the data is already there.

One page, one row per employee, one column per month: contracted hours
(`employees.monthly_working_hours`), planned hours (confirmed plans × the shift's
`weekday_times` duration), the difference, and a running balance carried forward.
Click a row for the month's days behind the number.

Everything needed is in the database; the arithmetic is the same
`_duration_hours` the plan check already does
(`agent/shift_agent/agent/validation.py`). It wants a real endpoint rather than
loading a year of plans into the browser — `GET /analysis/hours-account?from=&to=`
alongside the existing `/analysis/*` family.

The Employee Calendar already shows this for one person for one month; this is
the ward-wide, year-long version, and it is what a works council asks for.

### 2. Compliance over the confirmed roster

The plan check today answers for a *proposal*. Nobody checks the roster people
are actually working — which is the one that matters when a rest-period breach
becomes a real question.

The checking code is already independent of where the plan came from
(`validation.validate(rules, result)` takes a plain payload). What is missing is
a way to present the **confirmed** plans in the same shape: a
`POST /agent/plan/validate` variant taking `start_date`/`end_date` instead of a
`result_id`, building the result-shaped payload from `listConfirmedShiftPlans`.
That is a small function in `agent/shift_agent/agent/validation.py`.

Then: a standing "Compliance" page per month, with the same findings the
scheduler modal shows, and the **Fix Plan** repair pointed at the confirmed
roster instead of a proposal.

### 3. Absence requests and approval

Today an absence is a fact somebody types in. In most products it is a request
with a state: *requested → approved / rejected*, with an entitlement to draw
down and a planner inbox.

Needs: `status`, `requested_by`, `decided_by`, `decided_at`, `reason` on
`unavailabilities`, plus an entitlement per employee and year. Two views: a
self-service "request time off" for `shift-viewer` (the shift-wish page is the
pattern to copy, window rules and all) and an approval queue for planners, with
the conflict shown at decision time — *approving this leaves the ICU one short on
the 14th* is a question `_Rules.blocking_reason` in `repair.py` can already
answer.

### 4. Publish and notify

*Take as Plan* overwrites the confirmed roster silently. Nobody is told, and
there is no "what changed since you last looked".

Needs a published version per period (a snapshot, plus who published it and
when), a per-employee diff against the previous one, and a way to deliver it —
email at minimum. The UI: a *Publish* step next to *Take as Plan*, showing the
change list first, and a "what changed for me" banner on the employee's own
calendar.

This is the biggest missing piece of process, and the one wards notice on day
one.

### 5. Shift swaps and open shifts

An employee offers a confirmed shift; colleagues see it on a board; one claims
it; a planner approves. The same board carries shifts nobody is on yet.

Needs an offers table and a small state machine. The valuable part is cheap: the
check "may this person take this shift" is already implemented as
`_Rules.blocking_reason`, so an offer can be shown only to people it would be
legal for, and an approval can be refused with a reason rather than by feel.

### 6. Qualification matrix and expiry

A grid of employees × capabilities with the gaps visible is a page over data that
exists — worth building on its own, since it is how a ward manager spots that
only two people can run the ICU at night.

Expiry is the follow-up and needs `valid_from` / `valid_until` on
`employee_capabilities`, after which the matrix colours what is about to lapse
and the optimizer stops counting a qualification nobody has renewed.

### 7. Self-service roster feed

The Employee Calendar is already a good personal view. What is missing is getting
it *out*: a signed, per-employee ICS URL that phones subscribe to, so a changed
shift appears where people actually look. A read-only endpoint with a token in
the path, and a "Subscribe to my roster" button.

---

## Smaller elements, inside views that already exist

These are hours rather than days, and several would be felt daily.

**Schedule grid**

- **Violation markers in the cell.** The plan check produces findings with exact
  people and dates; the grid shows none of them. Mark the cell, tooltip the rule.
  It is the shortest path from "the check knows" to "the planner sees".
- **Drag to paint** an assignment across several days, and across several people.
- **Undo / redo** for hand edits. Every edit is a PUT today, with nothing behind it.
- **Keyboard navigation** — arrow keys between cells, a key to assign, a key to
  clear. Planners work these grids all day.
- **A density toggle** (comfortable / compact) for a month on a laptop screen.
- **Colour-blind-safe shift colours**, or a pattern in addition to the colour.
  Shift identity currently rests on hue alone.

**Filtering and finding**

- **Saved filters** — by capability, by workstation, by team — as chips above the
  grid, shared with the Day View.
- **"Only problem days"** toggle: show the days that are understaffed or carry a
  finding.
- **A command palette** (Ctrl-K) over pages, employees and actions. The assistant
  already resolves "take me to the planner settings"; this is the keyboard
  version of the same thing.

**Around the edges**

- **Per-day handover notes** on a shift — the thing wards currently keep on
  paper next to the printed plan.
- **Background job toasts** — an optimizer run that finishes while you are on
  another page should say so.
- **A print stylesheet** for the month grid. The Excel export is not what gets
  pinned to the wall.
- **Empty states with a next step** on every configuration page, and a first-run
  checklist on the dashboard (the *First steps* guide exists; the product does
  not show it).
- **Week start and timezone** as an explicit tenant setting rather than a locale
  side-effect.

## Where to start

1. **Hours account** — a page over data that already exists, answering a
   question the product is currently silent on.
2. **Violation markers in the grid** — small, and it makes work already done
   visible.
3. **Compliance over the confirmed roster** — a small change to the validation
   entry point turns the whole checking and repair machinery on the roster that
   actually matters.
4. **Absence requests** and **publish/notify** — the two workflow gaps. Bigger,
   and worth deciding on deliberately rather than sliding into.
