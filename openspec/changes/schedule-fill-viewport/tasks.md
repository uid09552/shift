# Tasks

## 1. Publish the header height

- [ ] 1.1 In `AppHeaderComponent`, observe the host's height with a `ResizeObserver` and set `--app-header-height` on `document.documentElement`; remove the observer on destroy; verify with a unit spec that the variable follows a resize of the header element

## 2. Page frame

- [ ] 2.1 In `kalender.component`, give the host the frame height `calc(100dvh - var(--app-header-height, 4.5rem) - page padding)` with a minimum, as a flex column; make the card `flex-1 min-h-0` and flex column; verify the page has no vertical scrollbar at 1440x900
- [ ] 2.2 Replace `max-h-[calc(100vh-260px)] overflow-x-auto overflow-y-auto` on the table box with `flex-1 min-h-0 min-h-[24rem] overflow-auto`; keep the sticky header and name column working; verify with the browser check below
- [ ] 2.3 Make `app-grouped-plan-view` and `app-day-view` fill the same area (no extra scroll wrapper); verify grouped-by-workstation, grouped-by-shift and Day view each show a single scrollbar

## 3. Verify

- [ ] 3.1 Component spec: the table box carries the flexible-height classes and no `max-h` guess; the other views render inside the same area
- [ ] 3.2 Robot case under `e2e/tests/schedule/`: on the Schedule page `document.documentElement.scrollHeight <= clientHeight` at the default window size; verify with `cd e2e && make dryrun`
- [ ] 3.3 Check in the browser at 1440x900, 1280x720, a phone width and in dark mode: one scrollbar (the table's) except on the very short window, sticky header row and names column intact, toolbar wrapping handled; run `ng build` and `ng test`
