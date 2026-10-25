## Context

`RotationsComponent` lays out a `xl:grid-cols-3` grid: patterns `col-span-1`, apply `col-span-2`. The component is a single inline template.

## Goals / Non-Goals

**Goals:** Apply panel and preview grid use the full width. No behavior or API change.

**Non-Goals:** A separate route or modal for Apply; restyling the editor.

## Decisions

- **Stack, don't widen the column.** Drop the 3-column grid: patterns section on top (full width), Apply section below (full width). Alternative — collapsing the patterns column — hides the pattern picker that Apply depends on. A full-width patterns list is short (chips per row), so the apply panel stays near the top.
- **Pattern list as a responsive grid.** Render the pattern items in `grid sm:grid-cols-2 xl:grid-cols-3` so a full-width list does not become a long stretched column. The editor, when open, keeps a readable max width (`max-w-3xl`).
- **People list height.** Replace `max-h-56` with a viewport-relative max (`max-h-[40vh]`) so it uses spare space.
- Template-only change; `data-testid`s untouched.

## Risks / Trade-offs

- Stacking pushes Apply lower when many patterns exist → mitigated by the multi-column pattern grid; selecting a pattern keeps the page in place.
