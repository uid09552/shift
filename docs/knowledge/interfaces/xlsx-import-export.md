---
type: API Surface
title: XLSX Import and Export
description: Template/import endpoint pairs for bulk data entry, and the calendar exports — how a paper ward gets into the system.
resource: src/services/xlsx_io.rs
tags: [interfaces, import, export, spreadsheet]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/backend.md
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: docs/guide/setup.md
    author: human:maxrg
    last_modified: 2026-07-31
---

Four resources expose a matching template/import pair:

```
GET  /api/v1/{resource}/template   # download an empty spreadsheet
POST /api/v1/{resource}/import     # multipart upload of a filled one
```

Where `{resource}` is `employees`, `shifts`, `capabilities` or `workstations`.

Templates are generated with `rust_xlsxwriter`; uploads are parsed with
`calamine`. Shared helpers live in `src/services/xlsx_io.rs`.

# The workflow

1. `GET /{resource}/template` — an `.xlsx` with the right columns and headings
   already in place.
2. Fill it in, one row per item, in any spreadsheet program.
3. `POST /{resource}/import` as multipart.

**Use the downloaded template rather than building your own spreadsheet.** Column
names must match exactly; a hand-built file with plausible-looking headers is the
usual cause of a failed import.

Order matters, because the entities reference each other: capabilities before
workstations (which require them) and before employees (who hold them), shifts
before workstations (which list them as active). See
[Ward setup](/guide/ward-setup.md).

Import is how a ward already tracked in a spreadsheet gets into the system —
substantially faster and less error-prone than typing forty people into forms.

# Calendar export

Every calendar view in the UI has an **Export Excel** button that exports exactly
the current view — the week or month on screen, in the arrangement on screen.
Used for circulating a roster, sending one person their own month, or keeping an
archive copy before recalculating a period.

This is an export only; there is no calendar re-import. The system is not
connected to payroll or time-clock systems, so exported hours are *planned*
hours, not hours worked.

# Related

* [REST API](/interfaces/rest-api.md)
* [Backend service](/architecture/backend-service.md)
* [Reading calendars](/guide/reading-calendars.md)
