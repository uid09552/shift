# Proposal

## Why

The list and data tables look unfinished and inconsistent. Each of the seven
pages hand-rolls its own `<table>` with about 40 utility classes, and they have
drifted apart. Header and body cells use different padding (`px-5` against
`px-5 sm:px-6` and `px-4` in the same column), so header labels sit 4 px off the
content beneath them. Cards mix `rounded-xl` and `rounded-2xl` and two dark-mode
border colours. The five configuration lists have no hover state, no row rhythm
and no depth, which makes long lists hard to scan.

## What Changes

- New shared table classes in `ui/src/styles.css` (Tailwind `@utility`): card
  shell, table, header row, header cell, body cell, numeric cell, actions cell,
  and empty/loading state. They are the single source for padding, typography,
  borders and colours, in light and dark mode.
- Look:
  - card: `rounded-2xl` with a light shadow (`shadow-theme-xs`)
  - header row: lightly tinted (`gray-50`), with small uppercase, letter-spaced
    labels
  - data rows: alternating subtle backgrounds (zebra) and a hover highlight
  - one padding scale: header and cell share it, so columns line up at every
    breakpoint
  - numbers right-aligned with tabular figures
  - actions column right-aligned
- Applied to the list tables (Shifts, Capabilities, Workstations, Employees,
  Users) and the data tables (Audit log, Fairness). The Audit log keeps its
  day-group rows and gets hover without zebra, because its day headings already
  give the rhythm.
- Row actions become **icon buttons** instead of text buttons: edit (pencil),
  delete (trash), deactivate/reactivate a workstation, and remove a user. Each
  icon carries its translated label as `aria-label` and tooltip. A new shared
  `app-icon-button` holds the icon set, so the SVGs live in one place.
- Behaviour otherwise stays the same: double-click and right-click on rows,
  sorting in Fairness, row expansion in the Audit log, and every `data-testid`.

Non-goals:

- The calendar grids and matrices (Schedule week view, scheduler proposal,
  rotations preview, employee calendar, `calendar-table`, grouped plan view).
  They need their own design pass, because zebra striping clashes with shift
  colours.
- A data-table component, sorting, paging or column configuration.
- A sticky header (see design).
- A "..." overflow menu for row actions.
- Toolbar buttons above the tables (Template, Import, Add), which keep their text.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
<!-- none: a visual restyle with no change to behaviour, so this change sets skip_specs -->

## Impact

- **UI only**: `ui/src/styles.css` gets the new utilities, and
  `shared/components/ui/icon-button/` is the new icon button. The table markup in
  `pages/configuration/{shifts,capabilities,workstations,users,audit-log}` and
  `pages/planner/{user-profiles,fairness}` changes its classes only.
- No API, backend, data or dependency changes.
- E2E: the selectors are `data-testid` attributes, which are kept, so no suite
  changes are expected.
