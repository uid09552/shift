# Design

## Context

Pages subscribe to services directly and handle `error:` themselves. A survey of
every `console.error` in `pages/` and `shared/` found three groups:

- **Already right.** Kalender and employee-calendar create/update/swap call
  `showSaveError(err)`, which sets `saveError = err.error.error ?? t('schedule.saveFailed')`
  and renders a dismissible banner. Planner and wish settings call
  `showMessage(...)`. The users, audit-log and fairness pages have an `error`
  state with "could not be loaded".
- **Failed load shown as empty.** The shifts, capabilities, workstations and
  user-profiles lists reset `loading` and leave the list `[]`, which renders the
  empty state. Kalender's `loadPlans` calls `planMap.clear()`, which renders a
  blank roster. Kalender's wish load, employee-calendar's confirmed plans and
  wish-settings loads, the scheduler's four loads, and the workstation details,
  closures and unavailabilities loads are also affected.
- **Failed action silent.** These failures are only logged:
  - template download, import, delete and reactivate on the four lists
  - plan delete on both calendars
  - wish create and delete on employee-calendar

The backend's error body is always `{"error": "<reason>"}`, plus `code` for 428.
`reasonRequiredInterceptor` hands a cancelled 428 back to the caller, so it
reaches the same `error:` branch.

## Goals / Non-Goals

**Goals:**
- One way to turn an error into a message, and one look for each of the two
  outcomes (load failed, action failed).
- Keep each page in charge of where its message appears.

**Non-Goals:**
- An HTTP interceptor that shows errors globally. It would double up with the
  pages that already handle errors, and it can't know whether the empty state or
  a panel is the right place.
- Removing `console.error` calls. They stay as developer diagnostics next to the
  user-facing message.

## Decisions

### 1. `apiErrorMessage(err, fallbackKey)` helper

`shared/http/api-error.ts`:

```ts
export function apiErrorMessage(err: unknown, fallback: string, t: TranslationService): string
// HttpErrorResponse with a non-empty string err.error.error -> that string
// status 0 (network / backend down)                        -> t('common.offline')
// anything else                                           -> t(fallback)
```

The server's reason is already user-facing text, in the backend's language (the
same text the calendars show today). Status 0 gets its own message, "The server
could not be reached", because "could not be saved" doesn't help someone whose
backend is down. Kalender's and employee-calendar's `showSaveError` get
reimplemented on top of it, with no behaviour change.

### 2. `<app-load-error>` for failed loads

`shared/components/ui/load-error/load-error.component.ts`:

```html
<app-load-error [message]="'shifts.loadFailed' | t" (retry)="loadShifts()" />
```

It renders a `role="alert"` block: a warning icon, the message, and an outline
*Retry* button using `common.retry`. It carries `data-testid="load-error"`. Inside
a table it goes in the same place as the empty state, in a
`<td colspan class="table-empty">`, so the table layout from
`unify-table-styling` stays as it is.

Each list gets a `loadError` flag next to `loading`, and the template order is:

```
@if (loading) { loading row }
@else if (loadError) { <app-load-error> row }
@else if (items.length === 0) { empty state }
@else { rows }
```

For Kalender, `loadPlans` and `loadWishes` set `loadError` instead of clearing
the map, and the grid area shows `<app-load-error>` with *Retry* (`loadPeriod()`).
The base-data error (`schedule.loadFailed`) already exists and moves to
`<app-load-error>` with its existing Retry (`loadAll()`).

The Employee calendar follows the same pattern: `plansLoadError` replaces the
weeks grid with `<app-load-error>` (Retry → `loadPlansForMonth()`), and its
base-data error gains the Retry it lacked (`loadInitialData()`). A failed
**wish-window** load is the exception: it gets a notice, not a load-error
block. The calendar stays fully usable, `wishAllowedOn(null)` offers every
day, and the server still refuses a wish outside the window, a refusal this
change now reports. Replacing the calendar for a missing hint would be worse
than the failure.

*Alternative considered:* reusing the bare `<p role="alert">` markup that audit-log
and fairness use. That gives the same look, but without a retry and copied once
more. Those two pages move to `<app-load-error>` too, since it is a one-line swap
and makes the pattern uniform.

### 3. `<app-error-notice>` for failed actions

`shared/components/ui/error-notice/error-notice.component.ts`:

```html
<app-error-notice [message]="actionError" (dismiss)="actionError = null" />
```

It renders nothing when `message` is null. Otherwise it shows the same banner the
calendars render today (error colours, `role="alert"`, a close button with
`common.close`, `data-testid="error-notice"`). The list pages place it where the
import-result banner sits, under the card header. The calendars replace their
inline `saveError` banner markup with it.

The notice stays until it is dismissed or the next action succeeds. A successful
action clears `actionError`, so a stale error never sits next to fresh data.

*Alternative considered:* a toast service. Rejected because a toast disappears
before a planner reads "Month is locked: reason required". The calendars chose
inline banners for that reason, and this change keeps that choice.

### 4. Leave data untouched on failure

On every action error the page leaves its state alone: no optimistic removal,
no `loadPlans()` refetch. Today's deletes already update state only in `next:`;
this change keeps it that way and adds the notice. The one existing refetch on
failure, swap's `failed()` calling `loadPlans()`, stays, because a swap may
have half-applied.

### 5. Removing the demo auth pages

Delete:
- `pages/auth-pages/` (sign-in, sign-up)
- `shared/components/auth/` (signin-form, signup-form)
- `shared/layout/auth-page-layout/`, used only by those pages

Edit:
- `app.routes.ts`: drop both routes. `**` then serves `NotFoundComponent`.
- `app-sidebar.component.ts`: drop `othersItems` and its two uses: the
  active-route loop (line 159) and the `{ items: this.othersItems, prefix: 'others' }`
  group (line 200) used for active-route highlighting. The template loops over
  `navItems` only, so these entries were never rendered: nothing visible
  changes in the sidebar.
- `chat-widget.component.ts`: `HIDDEN_ON` lists only `/signin` and `/signup`,
  so drop it together with the `hidden` flag and the router subscription that
  maintains it.
- `de.ts` / `en.ts`: drop `nav.authentication`, `nav.signIn`, `nav.signUp`,
  `title.signIn`, `title.signUp` and any `auth.*` keys used only by the forms.

### 6. i18n

New keys (de/en):
- `common.offline`
- `common.loadFailed` (generic "could not be loaded")
- per-page load messages where none exist: `shifts.loadFailed`,
  `capabilities.loadFailed`, `workstations.loadFailed`,
  `userProfiles.loadFailed`, `scheduler.loadFailed`
- per-action fallbacks: `common.deleteFailed`, `common.importFailed`,
  `common.downloadFailed`, `wishes.saveFailed`

Existing `schedule.saveFailed` and `schedule.loadFailed` are reused.

## Risks / Trade-offs

- [The server's reason is in English for some errors, in a German UI] → This is
  today's behaviour on the calendars, unchanged. Translating backend errors is a
  separate concern.
- [Scheduler loads are four independent requests] → One `loadError` for the page
  data, shown at the top of the scheduler with Retry reloading all four. Partial
  data is worse than an honest error.
- [A page has a Retry and the error persists] → Retry just reruns the load. The
  message stays, and nothing loops automatically.

## Migration Plan

Frontend-only and stateless, so it deploys with the UI. Old bookmarks to
`/signin` or `/signup` land on not-found.
