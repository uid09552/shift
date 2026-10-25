# Tasks

## 1. Dependencies and navigation

- [x] 1.1 Add `d3-force`, `d3-drag`, `d3-zoom`, `d3-selection` and their `@types/*` to `ui/package.json` with `npm install`. Verify `npm run build` passes and `git diff ui/package-lock.json` adds only those packages and their own dependencies.
- [ ] 1.2 Add a `plannerOnly` flag to sidebar sub-items, filtered through `UserService.canPlan()` the way `adminOnly` is filtered, and drop a group left without items. Add a "Reports" group with `nav.relationships` → `/relationships` (`plannerOnly`), plus `nav.reports`, `nav.relationships` and `title.relationships` in `shared/i18n/en.ts` and `de.ts`. Verify that a planner sees Reports › Relationships and a viewer sees no Reports group.
- [ ] 1.3 Register the `relationships` route with `writerGuard` and `data: { listPath: '/' }`, lazily loading the new page from `ui/src/app/pages/reports/relationships/`. Verify that a viewer opening `/relationships` lands on `/`.

## 2. Graph model

- [x] 2.1 Write `relationship-graph.ts` next to the page: a pure `buildGraph(data, layer)` that returns typed nodes (`emp:`/`cap:`/`ws:`/`shift:` ids) and links. The four configured edge types, closed workstations and single points of failure (a capability required by an open workstation and held by fewer than two employees) come from the configuration. Assignment edges are aggregated per employee–workstation and employee–shift with a `days` count, skip absences and days off, and are flagged `uncovered` when a required capability is missing. Verify with `relationship-graph.spec.ts` covering each scenario under *Relationship network*, *Assignment edges* and *Single points of failure* in the spec.
- [x] 2.2 Add `applyFilters(graph, filters)` for node-type and edge-type toggles and name search: hiding a node type drops its edges, and a search yields the matching nodes and their neighbours. Verify with spec cases for *Hide shifts* and *Search*.

## 3. Relationships page

- [ ] 3.1 Create the standalone `RelationshipsComponent`. It loads employees, shifts, capabilities and workstations, then each workstation's required capabilities in parallel; a failed call falls back to an empty list and the page names the workstation it could not load. While loading it shows a loading state, and on an empty tenant a message that links to the configuration pages. Verify against a local stack: the network renders, and a tenant with no configuration shows the message.
- [ ] 3.2 Render the network as SVG with `d3-force`. Node types get the shapes and colours from design Decision 4, shift nodes use the shift colour, and a legend explains them. Add `d3-zoom` pan and zoom, `d3-drag` pin-on-drop (double-click releases), Reset layout, and hover/select highlighting of a node's neighbourhood with the rest dimmed. Verify by hand: drag ICU to the edge and it stays; double-click releases it; selecting a capability dims unrelated nodes.
- [ ] 3.3 Add the toolbar: type toggles (shifts hidden by default), search, an assignment-layer switch with day/week mode and a date picker that defaults to the current week, and a side panel for the selected node. Confirmed plans are fetched only while the layer is on, again when the period changes. Verify by hand: switching the layer on for a week with rostered entries draws dashed edges with day counts, and an assignment at a workstation the person isn't qualified for shows in the warning colour.
- [ ] 3.4 Size the SVG to the space below the toolbar, the way the Schedule page does, and stop the simulation once it settles. Verify with a generated 500-node fixture (a spec helper feeding `buildGraph`) that the layout settles and dragging follows the pointer without visible lag.
- [ ] 3.5 Add `data-testid` attributes (page, toolbar controls, legend, an SVG node per id), and an e2e suite `e2e/tests/reports/relationships.robot` with a page object under `e2e/resources/pages/`: as planner the page opens and shows nodes and toggles hide shifts, and as viewer the menu entry is absent. Verify with `cd e2e && make dryrun`, then `make e2e ARGS="--include relationships"` against a running stack.

## 4. Documentation

- [ ] 4.1 Add the Relationships report to `docs/` next to the other planner pages: what each shape and edge means, the assignment layer, single points of failure, and that the page is read-only. Add `reports/` to the pages tree in `CLAUDE.md`. Verify `mkdocs build --strict --site-dir site` (as in `.github/workflows/docs.yml`) passes.

## Workflow follow-up

- The UI unit test runner currently fails before running any test (`zone-testing` vs jasmine: "Cannot assign to read only property 'describe'"), with or without this change. Fix it first or alongside, so the `*.spec.ts` checks in groups 2 and 3 can run.
- Archive after review.
