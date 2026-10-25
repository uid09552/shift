# Design

## Context

The app shell ([app-layout](ui/src/app/shared/layout/app-layout/app-layout.component.html)) is `min-h-screen` with a growing content area, so the document scrolls. The Schedule page ([kalender.component.html](ui/src/app/pages/planner/kalender/kalender.component.html)) puts its table in `max-h-[calc(100vh-260px)] overflow-auto`: the 260px is a guess, and the real chrome above the table is taller, so both the table and the document scroll. The grouped views render inside that same box; the Day view has its own template and sits below the same toolbar. The app header is `sticky top-0` and its height changes with width (mobile wraps it).

## Goals / Non-Goals

**Goals:**
- Exactly one scrollbar (the table's) on the Schedule page at desktop and laptop sizes.
- No hard-coded guess of the chrome height anywhere.
- No behaviour change for other pages.

**Non-Goals:**
- Changing the shell for all pages, hiding the sidebar, or a "presentation mode".
- Restyling the table or its content.

## Decisions

- **Page-local frame, not a shell change.** The Schedule page's host becomes a flex column of height `calc(100dvh - var(--app-header-height) - 2 * page-padding)`; the card inside is `flex-1 min-h-0 flex-col`; the table box is `flex-1 min-h-0 overflow-auto`. The alternative, making the shell `h-screen` with an inner scroll container, would change every page's scrolling and needs a regression pass on all of them.
- **Measure, don't guess, the header.** `AppHeaderComponent` observes its own height with a `ResizeObserver` and sets `--app-header-height` on `document.documentElement`. The page reads the variable, so a wrapped mobile header or a future header change needs no edit here. A fallback value (`4.5rem`) is in the `calc` for the first paint.
- **Page padding.** The shell's `p-4 md:p-6` stays; the frame subtracts it, so the page is exactly one screen. The breadcrumb is part of the frame's flex column (fixed height), not subtracted separately.
- **Minimum height.** The table box has `min-h-[24rem]`; the frame uses `min-height` rather than a hard `height` below that, so on a short window the frame grows and the page scrolls (spec: small windows).
- **`100dvh`, not `100vh`.** Mobile browsers' dynamic toolbar otherwise leaves a gap or an overflow.
- **Day view.** It already lives inside the card; its chart container takes `flex-1 min-h-0 overflow-auto` the same way.

## Risks / Trade-offs

- A ResizeObserver on the header adds a tiny cost on resize only → acceptable.
- The frame's height rule must not leak to other pages → it is set on the Kalender host only (`:host`), not on the shell.
- Sticky header row and name column rely on the table box being the scroll container; moving the scroll container's height rule must keep `position: sticky` working → verified in the browser check.
- A very short window falls back to page scrolling (two scrollbars again), by design; the alternative of squeezing the table to nothing is worse.
