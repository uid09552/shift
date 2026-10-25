# Proposal

## Why

The UI sometimes tells planners something untrue.

- **Failures look like empty data.** When a list or the roster fails to load,
  the page logs to the console and shows the same "No shifts yet" or empty week
  as when there is genuinely nothing there. A planner who sees an empty Employees
  page or a blank roster during an outage may start re-entering data. Several
  write actions fail without any sign at all:
  - deleting an assignment in a locked month
  - placing a shift wish outside the wish window
  - deleting a shift that is still in use
  - downloading a template or importing a file
- **A fake sign-in form.** `/signin` and `/signup` still serve pages left over
  from the UI template, although real sign-in is Keycloak. The sidebar defines
  entries for them (`othersItems`) but never renders them, so they are reached
  only by URL. The sign-in form submits nothing and writes the typed email and
  **password to the browser console**.

## What Changes

- **Load failures are shown as failures.** Each affected page or panel shows a
  "could not load" message with a *Retry* button instead of the empty state:
  - the Shifts, Capabilities, Workstations and Employees lists
  - the Schedule's roster and wishes
  - the Employee calendar's confirmed roster and wish window
  - the Scheduler's runs, employees, shifts and workstations
  - a workstation's details, closures and unavailabilities

  The empty state appears only after a successful load returns nothing. A failed
  roster load no longer clears the grid to blank.
- **Failed actions say why.** These failures show a dismissible error notice,
  with the server's own reason where it gives one ("Month is locked") and a
  generic text otherwise:
  - template download, import, delete and reactivate on those lists
  - assignment delete on both calendars
  - wish create and delete on the Employee calendar

  This is the behaviour the calendars already have for create and update, made
  shared.
- **Demo auth pages removed.** The `/signin` and `/signup` routes, the sidebar's
  unrendered *Authentication* entries, and the template's sign-in and sign-up components
  are deleted. Sign-in stays where it is: the Keycloak login in front of the app.
  An old `/signin` link now reaches the existing not-found page.

Non-goals:

- A global HTTP error interceptor or a toast system. Each page keeps owning its
  messages, which a caller already does today for 428 handling.
- The notification bell, which stays silent on failure: it is a convenience, and
  an error there would be noise.
- Visual polish, colour tokens and the untranslated strings (a separate polish
  change).

## Capabilities

### New Capabilities
- `ui-feedback`: How the UI reports the outcome of loading and changing data. A
  failed load is never shown as empty data, and a failed action is reported with
  the server's reason.

### Modified Capabilities
- `user-management`: Adds that sign-in and sign-up happen only through Keycloak.
  The app offers no sign-in or sign-up form of its own.

## Impact

- **UI only.** Two shared pieces go in `shared/components/ui/`: a load-error
  block with retry, and an error notice. A helper turns an `HttpErrorResponse`
  into the message to show. These pages and components get edited:
  - shifts, capabilities, workstations (list and form), user-profiles
  - kalender, employee-calendar, scheduler
  - `app.routes.ts`, the sidebar and the chat widget's hidden routes
  - `de.ts` / `en.ts`
- **Deleted:** `pages/auth-pages/`, `shared/components/auth/`,
  `shared/layout/auth-page-layout/`, and the `nav.authentication` /
  `nav.signIn` / `nav.signUp` / `title.signIn` / `title.signUp` keys.
- No backend, API or data changes. The backend already answers with
  `{"error": "<reason>"}`.
- E2E: no suite visits `/signin` or `/signup`.
