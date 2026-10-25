# Design

## Context

There is no shared table code. The five configuration lists (`shifts`,
`capabilities`, `workstations`, `users`, `user-profiles`) are near-copies:

- the card is `overflow-hidden rounded-xl border bg-white`
- the header cells are `px-5 py-3 text-theme-xs text-gray-500`
- the body cells mix `px-5 py-4 sm:px-6` with `px-4 py-3`
- the rows are `divide-y`, with no hover

The two newer tables are more refined but differ from each other:

- `audit-log` has `scope="col"`, hover, day-group `<th colspan>` rows and
  expandable rows
- `fairness` has sortable header buttons, `tabular-nums` and right-aligned
  numbers

`styles.css` already defines component-level classes with Tailwind v4
`@utility` (`menu-item`, …) and uses dark mode through `@custom-variant dark`.
Shadow tokens such as `shadow-theme-xs` exist in `@theme`.

## Goals / Non-Goals

**Goals:**
- One place that defines the table look. Changing padding or colour later is a
  one-line edit.
- Columns line up: header and cell use the same horizontal padding at every
  breakpoint.
- Zebra rows, hover, a tinted header and a card shadow, all in both themes.

**Non-Goals:**
- Changing any template structure, binding or `data-testid`.

## Decisions

### 1. Shared `@utility` classes, not a component or directive

Add to `styles.css`:

| class | applies to | content |
|---|---|---|
| `table-card` | wrapper `<div>`/`<section>` | `overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]` |
| `table-scroll` | the `overflow-x-auto` div | `max-w-full overflow-x-auto` |
| `table-base` | `<table>` | `w-full text-theme-sm text-gray-700 dark:text-gray-300`. It carries the cell text colour, which cells inherit (see decision 2a) |
| `table-head` | `<thead>` | `border-y border-gray-100 bg-gray-50 dark:border-white/[0.05] dark:bg-white/[0.02]` |
| `table-th` | `<th>` | `px-5 py-3 text-theme-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap dark:text-gray-400` |
| `table-tr` | body `<tr>` | `border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50 dark:border-white/[0.05] dark:hover:bg-white/[0.05]` |
| `table-striped` | `<tbody>` | even rows `bg-gray-50` / dark `bg-white/[0.025]`, through `tr:where(:nth-child(even))` so a row's hover always wins |
| `table-td` | `<td>` | `px-5 py-3 align-middle`, with no colour |
| `table-num` | numeric `th`/`td` | `!text-right tabular-nums` |
| `table-actions` | actions `th`/`td` | `!text-right whitespace-nowrap` (inner flex `justify-end`) |
| `table-empty` | empty/loading `<td colspan>` | `px-5 py-12 text-center text-gray-400 dark:text-gray-500` |

The values above were tuned by eye in both themes against screenshots. Tailwind's own `table-row` (`display: table-row`) is why the row class is called `table-tr`. What matters is that `table-th`
and `table-td` share `px-5`, and that nothing on a page overrides horizontal
padding.

*Alternatives considered:*
- An Angular `<app-table>` component. Rejected because every page renders
  bespoke cells (colour swatches, shift chips, role badges, sort buttons,
  expandable detail), so a component would mostly forward templates and buy
  nothing over CSS.
- An `appTable` attribute directive that adds classes. It works, but it moves
  styling into TypeScript and needs inputs for variants that CSS expresses with
  one more class.

### 2a. Cell colour lives on the table, not the cell

`table-td` sets no colour. A cell that needs one (muted actor names, the amber
"off target" hours in Fairness) adds its own class. If `table-td` also set a
colour, the winner between two single-class utilities would depend on CSS output
order, which isn't reliable. `table-num` and `table-actions` set alignment with
`!important` for the same reason: they have to beat `table-th`'s `text-start`.

### 2. Zebra is opt-in on `<tbody>`

`table-striped` uses `nth-child(even)`, which counts every row. That is right
for the flat lists and Fairness. In the Audit log, the day-group heading rows
and the inline detail rows would throw the stripe off and make it alternate
unpredictably, so the Audit log omits `table-striped` and keeps hover only. Its
day headings use `table-head`-like tinting through the existing
`bg-gray-50/80`, which stays.

*Alternative considered:* computing even/odd in the template with `@for`'s
`$even`. It is precise, but it puts presentation logic in seven templates.
Since only the Audit log has non-data rows, the opt-out is simpler.

### 3. Hover colour uses the brand tint, and the zebra stays neutral

A neutral zebra (`gray-50/60`) and a faint brand hover (`brand-50/40`) are easy
to tell apart. With both in grey, a hovered even row would be indistinguishable
from an odd one. Rows that are clickable (list pages open on double-click, the
Audit log on click) keep `cursor-pointer` where they have it today. The list
pages don't, and this change doesn't add it.

### 4. No sticky header

Each table sits in a horizontal `overflow-x-auto` container, inside a card with
`overflow-hidden`. `position: sticky` on `<thead>` would stick relative to that
container, which doesn't scroll vertically, so it would never visibly stick.
Making it work means giving each table a max height and a vertical scroll box,
which changes the page layout. That is out of scope.

### 5. Card header and toolbar untouched

The title and button bar above each table (`px-5 py-4 sm:px-6`) stays. It is
aligned to `sm:px-6`, while table cells use `px-5`. For the first column to line
up with the title, the card header changes to `px-5`, a one-class edit per page
that is included in the per-page tasks.

### 6. Fairness keeps its own header button

The sort `<button>` inside `table-th` keeps its classes. `table-th` provides the
padding and colour, and the button's active state still overrides the colour.
Its current inner `px-2 sm:px-3` on the scroll container goes away, so its
columns line up with the card header like the other tables.

### 7. Row actions as icon buttons (`app-icon-button`)

The row actions on the list pages were text buttons ("Bearbeiten",
"Löschen", "Deaktivieren"). At about 200 px per row they took the widest
column, and two full-size coloured buttons per row made the tables look loud.
They become 32 px square icon buttons through a new shared component:

```html
<app-icon-button icon="edit" [label]="'common.edit' | t" (btnClick)="openEditForm(x)" />
<app-icon-button icon="delete" tone="danger" [label]="'common.delete' | t" (btnClick)="delete(x)" />
```

- `icon`: `edit` | `delete` | `deactivate` | `reactivate` | `remove-user`. The
  inline 24 px stroke SVGs live in the component, so pages hold no SVG.
- `label`: required. It is rendered as `aria-label` and `title` (tooltip), and
  the translated text keeps screen readers and hover users informed.
- `tone`: `neutral` (default; gray, hover gray-100) or `danger` (gray at rest,
  red with an error-50 background on hover). Delete no longer shouts in red on
  every row; the red appears only on hover and in the confirm dialog that
  already follows.
- `disabled` and `btnClick` work as in `app-button`. A disabled button gets
  `opacity-40`, `cursor-not-allowed` and emits nothing.
- `data-testid` stays on the host element, as on `app-button` today.

*Alternatives considered:*
- Inline SVG per page with a `table-icon-btn` utility. Rejected because it
  pastes the same SVGs into five templates, the drift this change removes.
- An icon library (lucide-angular and the like). Rejected because it is a new
  dependency for five icons.

## Risks / Trade-offs

- [Icons alone are less discoverable than words] → Every icon has a tooltip and
  an `aria-label`. Edit is also on double-click and in the right-click menu,
  which are unchanged.

- [Uppercase header labels in German get long, e.g. "ERFORDERLICHE
  FÄHIGKEITEN"] → `whitespace-nowrap` with horizontal scroll is the existing
  behaviour. If a page gets too wide, drop `uppercase` globally in one place.
- [A page-specific class overrides padding again later] → It is checked at
  review time. Task 3 greps for leftover `px-4`/`sm:px-6` inside the seven
  tables.
- [The dark-mode zebra is too faint or too strong] → Check it by eye in both
  themes on the Employees page (the longest list) during task 1, and tune it in
  the single utility.
- [The visual change surprises e2e screenshot baselines] → The suites use
  `data-testid` and don't compare screenshots, so no baseline exists to break.
