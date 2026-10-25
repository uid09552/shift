# Proposal

## Why

On Shifts, Workstations, Capabilities, Users and Employees, "Add" and "Edit" open the form at the top of the same page, above the list. The list is pushed down, the form competes with the table and import controls for attention, long forms (a shift's seven weekdays, a workstation's rules) scroll the page away from the Save button, and the form has no address: it can't be linked, reloaded or reached with the browser's Back button. Each form should be a page of its own.

## What Changes

- Each of these screens gets a dedicated **form page** instead of the inline form above the list:
  - Shifts: `/shifts/new`, `/shifts/:id/edit`
  - Workstations: `/workstations/new`, `/workstations/:id/edit`
  - Capabilities: `/capabilities/new`, `/capabilities/:id/edit`
  - Employees: `/user-profiles/new`, `/user-profiles/:id/edit`
  - Users: `/users/new` (create only; roles stay editable in the list)
- Add/Edit buttons, row double-click and the context menu navigate to the form page; Save and Cancel return to the list, which shows the saved item.
- A shared form-page layout (breadcrumb, title and subtitle, sticky action bar with Save/Cancel, validation summary) so all forms behave alike.
- Unsaved changes ask before leaving; a deep link to an unknown id shows "not found" with a way back.
- The inline forms are removed. Existing `data-testid`s on fields and actions are kept so the e2e suites keep working; the list pages and their import/export are unchanged.

Out of scope: the Rotations editor, planner/wish settings (already full pages of settings, not add/edit forms), confirm and reason dialogs, any API or data change.

## Capabilities

### New Capabilities
- `settings-form-pages`: how add/edit forms for configuration items are presented and navigated.

### Modified Capabilities

(none — no existing spec covers UI presentation; behaviour of the items themselves does not change)

## Impact

- UI only: `app.routes.ts`, the five list components (inline form code moves out), five new form components, a shared form-page layout and an unsaved-changes guard, i18n (`en.ts`, `de.ts`), e2e page objects for the form locations.
- No backend, API, database or optimizer change.
