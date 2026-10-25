# Design

## Context

- The page lives in `ui/src/app/pages/reports/relationships/`: the component,
  its CSS, the model `relationship-graph.ts` and its spec. It is loaded
  lazily from `app.routes.ts` under `writerGuard` with `data.listPath: '/'`.
- The app already handles retired addresses with redirect routes, for
  example `day-view` → `/kalender?view=day` and `workstation-calendar` →
  `kalender`, each with a comment saying why it is kept.
- The component's stylesheet is unencapsulated and scoped under the host
  class `rel`. It sits about 20 bytes under Angular's 4 kB per-component
  style budget.
- `docs/knowledge/concepts/index.md` has a section "The relationship graph".
  It is an ER diagram of the database tables, not this page.

## Goals / Non-Goals

**Goals:**
- One name everywhere a person or a test sees it: menu, heading, title,
  address, docs and test ids.
- Old links keep working.

**Non-Goals:**
- Renaming the capability `relationship-graph`, or the concepts-index
  section about the data model.
- Any change to what the page shows or does.

## Decisions

**1. Move files with `git mv`, then edit.** History follows the files, so
`git log --follow` on `ontology.component.ts` still shows the page's origin.
The new names:

| Before | After |
|---|---|
| `pages/reports/relationships/` | `pages/reports/ontology/` |
| `relationships.component.{ts,css}`, `RelationshipsComponent`, selector `app-relationships` | `ontology.component.{ts,css}`, `OntologyComponent`, `app-ontology` |
| `relationship-graph.ts` / `.spec.ts` | `ontology-graph.ts` / `.spec.ts` |
| keys `nav.relationships`, `title.relationships`, `relationships.*` | `nav.ontology`, `title.ontology`, `ontology.*` |
| `data-testid="relationships-…"` | `data-testid="ontology-…"` |
| `relationships_page.resource`, `tests/reports/relationships.robot`, tag `relationships` | `ontology_page.resource`, `tests/reports/ontology.robot`, tag `ontology` |
| `docs/assets/screenshots/relationships.png` | `ontology.png` |

Keys are renamed, not duplicated: `de.ts` is typed against `en.ts`, so a
missed key fails the build.

**2. Redirect `/relationships` → `/ontology` with a plain `redirectTo`
route.** It follows the `day-view` pattern, with a comment saying why it is
kept. The redirect is applied before guards run, so `writerGuard` on
`/ontology` still decides access, and a viewer ends up on `/`, as before.

**3. Keep the CSS host class `rel`.** It is internal, invisible, and
already tied to the style budget. A longer class repeated on about 60
selectors would push the stylesheet over 4 kB. The component's comment
explains the class, so nobody has to guess at the short name.

**4. German label: "Ontologie".** It is the established German term, and it
matches how the guide uses English terms elsewhere. The headings inside the
page ("Who can work where" / "Wer kann wo arbeiten") stay: they describe what
the page answers.

## Risks / Trade-offs

- [A missed `relationships` string leaves a dead `data-testid` or
  translation key] → after the rename, `grep -rni relationship` over `ui/src`,
  `e2e/` and `docs/` must list only intended hits: the model's edge-type
  wording and the concepts index.
- [The e2e dry run passes on renamed keywords that point at stale selectors]
  → the dry run only resolves keywords. The live run of the renamed suite is
  the real check, together with the new redirect test.

## Migration Plan

Deploy as usual. Old bookmarks keep working through the redirect. Rollback
means reverting the commit.
