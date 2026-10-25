# Proposal

## Why

The spreadsheet imports for shifts, capabilities, workstations and employees read
cells by position and never look at the header row. A file whose columns are in a
different order is imported without any warning: an employee sheet with `email`
before `name` creates people named `anna@clinic.de`. Real files come from other
tools and from people's own spreadsheets. They seldom match the template's order,
and they sometimes have German headers, title rows above the header, or a cover
sheet in front.

## What Changes

- Imports read columns **by header name**, not by position. Headers are compared
  case-, space- and punctuation-insensitively against each field's name plus
  English and German aliases (`E-Mail`, `Kürzel`, `Farbe`, `Fähigkeiten` …).
- The header row is detected within the first rows of the sheet, so title rows
  above it are skipped. Columns that match no field are ignored.
- New **preview** endpoint per entity: upload a file and get back the sheets, the
  detected header row, each column with sample values and the field it was mapped
  to, plus required fields still unmapped and headers that matched more than one
  field. Nothing is written.
- The import endpoint accepts an optional **mapping** (sheet, header row,
  field → column). Without one it uses the detected mapping.
- **BREAKING (behaviour)**: an import whose required fields cannot all be mapped
  unambiguously is refused as a whole (400 naming the fields) instead of being
  imported by position. Files built from the current templates are unaffected.
  Files without any recognisable header row used to import by position and are
  now refused until the user maps their columns.
- `.xls`, `.xlsb` and `.ods` files are accepted alongside `.xlsx` (the existing
  reader, calamine, already supports them).
- UI: the Import button on the Shifts, Capabilities, Workstations and Employees
  pages opens a shared **import dialog**. It shows the detected mapping as a
  table (header, sample values, a field dropdown per column), lets the user pick
  another sheet, flags missing required fields, and imports only once the mapping
  is complete. The result banner stays as it is.
- The employee import still refuses the old monthly hours columns
  (`max_working_hours`, `monthly_working_hours`) wherever they appear, and never
  maps them to `weekly_working_hours`.

Non-goals:

- Saved mapping profiles per tenant for recurring exports (possible follow-up).
- CSV upload.
- Updating existing records (imports keep creating; duplicates stay row errors).
- The roster import `POST /shift-assignments/import`, where the agent already does
  the column interpretation.
- Fuzzy or LLM-based header matching.

## Capabilities

### New Capabilities
- `spreadsheet-import`: How master data (shifts, capabilities, workstations,
  employees) is imported from spreadsheets. Covers header-based column detection,
  preview, user-assigned mapping, accepted file formats, and refusing a file that
  cannot be mapped.

### Modified Capabilities
<!-- none: employee-management's "Bulk import" requirement (import + template) still holds as written -->

## Impact

- **Backend**: `src/services/xlsx_io.rs` (field definitions, header detection,
  mapping, multi-format reading, multipart `mapping` part); the four importers in
  `services/shift.rs`, `capability.rs`, `workstation.rs`, `employee.rs` read by
  mapped field instead of index; template headers come from the same field lists;
  new `POST /{shifts,capabilities,workstations,employees}/import/preview` routes in
  `server.rs`.
- **API**: `api/openapi.yaml`, with new preview operations and the `mapping` part
  on the four import operations.
- **UI**: a new shared import dialog in `shared/components/`, wired into the four
  list pages and their services; i18n keys in `de.ts` / `en.ts`; `accept`
  extended to the new file types.
- **Tests**: unit tests for detection in `xlsx_io`; integration tests in `tests/`
  for reordered columns, German headers, title rows, refusal and an explicit
  mapping; UI specs for the dialog.
- No database changes, and no new dependencies.
