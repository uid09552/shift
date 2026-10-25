# Proposal

## Why

The Schedule page shows two vertical scrollbars at once: one for the table and one
for the whole page. The table's height limit is a guess (`100vh - 260px`) at how
much sits above it. The real stack (app header, breadcrumb, page padding, the
card's toolbar, the month-status bar) is taller, so the page overflows the window
and scrolls as well. Planners lose their place scrolling the wrong one, and the
sticky header row and name column work against the page scroll.

## What Changes

- **The Schedule page fills the window.** Below the app header, the page is exactly
  as tall as what is left of the window. The page itself does not scroll.
- **One scroll area per view.** The table (employee grid, grouped-by-workstation and
  grouped-by-shift grids) takes the height left over after the toolbar and legend,
  and scrolls in both directions inside it. The guessed `max-h` is removed.
- **The Day view follows** the same rule: its chart scrolls inside the page frame.
- **Small windows keep working.** Under a minimum height, or on a phone where the
  toolbar wraps, the table keeps a usable minimum height and the page scrolls
  normally rather than squeezing the table to nothing.
- The app header publishes its measured height as a CSS variable, so no page has to
  guess it.

Non-goals: a presentation mode that hides the sidebar; changing any other page's
scrolling; changing the table's content, columns or editing behaviour.

## Capabilities

### New Capabilities
- `schedule-layout`: How the Schedule page uses the window: one scrollbar for the
  data area, none for the page.

### Modified Capabilities
<!-- none -->

## Impact

- **UI only.** `shared/layout/app-header` (publishes `--app-header-height`),
  `pages/planner/kalender/kalender.component.{html,ts,css}` (page frame, removes the
  `max-h`), `grouped-plan-view` and `day-view` (fill the frame). No API, data or
  backend change.
- E2E: no selector changes; a Robot check asserts the page itself does not scroll.
