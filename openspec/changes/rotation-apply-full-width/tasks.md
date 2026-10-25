## 1. Layout

- [ ] 1.1 In `rotations.component.ts`, replace the `xl:grid-cols-3` wrapper with a single-column stack; remove `xl:col-span-1` / `xl:col-span-2` from the patterns and apply sections
- [ ] 1.2 Render the pattern list items as `grid sm:grid-cols-2 xl:grid-cols-3`; cap the open editor at `max-w-3xl`
- [ ] 1.3 Change the people list `max-h-56` to `max-h-[40vh]`

## 2. Verify

- [ ] 2.1 Check in the browser (wide, laptop and narrow widths, light and dark): grid uses full width, names stay sticky, no layout break with editor open
- [ ] 2.2 Run `make e2e ARGS="--include rotations"` (or the UI build) to confirm selectors still resolve
