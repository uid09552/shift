# Tasks

## 1. Page and route

- [x] 1.1 `git mv` `ui/src/app/pages/reports/relationships/` to `ui/src/app/pages/reports/ontology/`, then rename its files and symbols as in design Decision 1: `ontology.component.{ts,css}`, `OntologyComponent`, selector `app-ontology`, and `ontology-graph.ts`/`.spec.ts`, with imports updated. Keep the CSS host class `rel` (Decision 3). Verify `npm run build` passes with no style-budget warning, and the model spec passes (19 tests, same Node/Jasmine run as before).
- [x] 1.2 In `app.routes.ts`, rename the route to `ontology` (title `title.ontology`, still lazy, `writerGuard`, `listPath: '/'`), and add a `relationships` → `/ontology` `redirectTo` route with a comment, following `day-view`. Verify in the browser: as a planner, `/planner/relationships` ends on `/planner/ontology` with the page shown; as a viewer (mocked `/self`), both addresses end on the overview.
- [x] 1.3 Rename the translation keys in `en.ts` and `de.ts` (`nav.relationships` → `nav.ontology`, `title.relationships` → `title.ontology`, `relationships.*` → `ontology.*`), with labels "Ontology" / "Ontologie" and the title "ShiftPlanner - Ontology" / "ShiftPlanner - Ontologie". Update the sidebar entry (`nav.ontology`, `/ontology`, `plannerOnly`) and the component's key uses. Verify the build passes (de.ts is typed against en.ts) and the sidebar shows Reports › Ontology in both languages.
- [x] 1.4 Rename every `data-testid` from `relationships-…` to `ontology-…`, including the per-node `ontology-node-<type>:<id>`. Verify that `grep -rn "relationships" ui/src` returns nothing, and that `grep -rni "relationship" ui/src` finds only the model's edge-type wording ("configured relationship").

## 2. End-to-end tests

- [x] 2.1 `git mv` the page object to `e2e/resources/pages/ontology_page.resource` and the suite to `e2e/tests/reports/ontology.robot`. Update the selectors, keyword names and the tag `ontology`, and add a test "Old Relationships Address Leads To Ontology" (admin opens `${APP_PATH}relationships`, the URL ends with `/ontology`, the page is shown). Verify `cd e2e && make dryrun ARGS="--include ontology"` passes with 5 tests.

## 3. Documentation

- [x] 3.1 Rename the guide section in `docs/guide/calendars.md` to "Ontology — who can work where" (**Reports → Ontology**), the menu row in `docs/guide/first-steps.md`, the route row (`/ontology`, plus a note on the `/relationships` redirect) and source tree in `docs/frontend.md`, and the `reports/` line in `CLAUDE.md`. Verify with `grep -rn "relationships-who-can-work-where" docs` that no link pointed at the old anchor.
- [ ] 3.2 Recapture the guide screenshot as `docs/assets/screenshots/ontology.png` from the renamed page (Intensivpflege selected, roster week of 4 May 2026, seeded data), delete `relationships.png`, and update the image reference. Verify `mkdocs build --strict --site-dir site` passes.

## Workflow follow-up

- Run `make e2e ARGS="--include ontology"` against a full stack (gateway and Keycloak); this is still owed from `relationship-graph-report` as well.
- Archive after review. Syncing updates the two requirements in `openspec/specs/relationship-graph/spec.md` and adds *Former address*.
