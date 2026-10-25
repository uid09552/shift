# Proposal

## Why

The Reports page that draws employees, capabilities, workstations and shifts
as a network is called *Relationships*. **Ontology** names what it actually
shows: the ward's model of who and what exists and how the kinds relate
(has capability, requires, may work, runs). "Relationships" reads like
something about people. The page is new (archived on 2026-10-25), so
renaming it now costs little and avoids a later migration of bookmarks and
habits.

## What Changes

- **User-visible name:** the menu entry, page heading, browser title and
  breadcrumb become **Ontology** (German: **Ontologie**) under
  Reports. What the page shows and how it behaves do not change.
- **Address:** the page moves from `/relationships` to `/ontology`. The old
  `/relationships` address redirects to `/ontology`, so existing links and
  bookmarks keep working, and the same access rules apply.
- **Code, kept consistent with the name:**
  - the page folder `pages/reports/ontology/` and `OntologyComponent`
  - the model file `ontology-graph.ts` with its spec
  - translation keys `nav.ontology`, `title.ontology` and `ontology.*`
  - `data-testid`s `ontology-*`
  - the e2e page object and suite (`ontology_page.resource`,
    `tests/reports/ontology.robot`)
  - the guide screenshot
- **Docs:** the user guide section, the route table and source tree in
  `docs/frontend.md`, the menu table in First Steps, `CLAUDE.md`, and the
  concepts index.
- **Spec wording:** the `relationship-graph` requirements that name the page
  (*Relationship network*, *Access*) now say Ontology. A new requirement
  covers the redirect from the old address.

Not changed:
- The capability id `relationship-graph`. OpenSpec does not move
  capabilities, and the id describes what the page shows, not its label.
- The edge type "relationship" in the model, where it means a configured
  connection rather than the page.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `relationship-graph`:
  - *Relationship network* and *Access* name the page **Ontology**.
  - New: the old `/relationships` address redirects to the page, with the
    same access rules.

## Impact

- **UI:** `app.routes.ts` (new route and a redirect), the sidebar entry,
  `en.ts`/`de.ts` (keys renamed, not added), and the page folder renamed.
  Lazy loading and the d3 chunk are unchanged.
- **e2e:** the page object and the suite are renamed, and the suite gains a
  check that `/relationships` lands on `/ontology`.
- **Docs and screenshot:** `docs/guide/calendars.md` and
  `docs/assets/screenshots/relationships.png` → `ontology.png`.
- **No backend, API or data change.**
