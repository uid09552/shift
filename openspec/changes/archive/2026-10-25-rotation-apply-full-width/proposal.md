## Why

On the Rotations page the *Apply* panel — people, period, stagger, and above all the preview grid of every person × every day — is squeezed into two thirds of the width (`xl:col-span-2`) beside the pattern list. The grid is the part planners study most, and for a month with many people it scrolls sideways inside a narrow box while the screen has plenty of unused space.

## What Changes

- The Apply panel uses the **full page width**. The pattern list moves above it as a full-width section instead of a left-hand column.
- Inside the wide Apply panel, the people picker and the period/options form sit side by side as before; the preview grid below spans the whole panel, so more days are visible without horizontal scrolling.
- The people list grows with the available height instead of a fixed `max-h-56`.
- Pattern editor, list actions, apply/preview/clear behavior, `data-testid`s and API are unchanged.

Out of scope: any change to what is written, previewed or validated; other pages; the pattern editor's content.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities
- `rotation-patterns`: adds a requirement on how the Apply screen uses the page width.

## Impact

- `ui/src/app/pages/planner/rotations/rotations.component.ts` (template layout classes only).
- e2e selectors (`rotation-patterns`, `rotation-apply`, `rotation-grid`) stay valid.
