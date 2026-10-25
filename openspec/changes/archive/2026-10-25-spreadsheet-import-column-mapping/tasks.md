# Tasks

## 1. Detection engine (`src/services/xlsx_io.rs`)

- [x] 1.1 Add `ImportField`, `normalize()` (case, umlaut/ß folding, strip non-alphanumerics) and the `ColumnMapping` wire type; verify with unit tests that `"E-Mail"`, `"e_mail"`, `"EMail "` → `email` and `"Kürzel"`/`"Kuerzel"` → `kuerzel`
- [x] 1.2 Switch the reader to `open_workbook_auto_from_rs`, list sheet names and read a named sheet (default first); verify with unit tests that the same rows come out of `.xlsx` and `.ods` fixtures and that a non-workbook gives a `Validation` error
- [x] 1.3 Implement header-row detection over rows 0–9 (most distinct fields matched, first row on a tie, row 0 when none) and the `Detection` with `mapping` / `ambiguous` / `missing_required`; verify with unit tests for title rows, reordered columns, two columns matching one field, and no header
- [x] 1.4 Implement `resolve` with an explicit mapping (unknown sheet, out-of-range column and a column used twice → `Validation`) and `read_mapped` returning rows addressable by field key with real 1-based row numbers, refusing when a required field is missing or ambiguous; verify with unit tests
- [x] 1.5 Extend `extract_uploaded_file` to also return the optional `sheet` and `mapping` text parts (bad JSON → `Validation`), and add a shared `preview` builder (sheets, sheet, 1-based header_row, row_count, fields, columns with ≤5 samples, missing_required, ambiguous); verify with a unit test of the preview JSON shape

## 2. Shifts and capabilities

- [x] 2.1 Declare `FIELDS` for shifts and capabilities (aliases per design), build `download_template` from them, and confirm the template header row is unchanged by asserting it in a test
- [x] 2.2 Port `import_shifts` and `import_capabilities` to `read_mapped` / `row.get(key)` / `row.number()`, and add `POST /shifts/import/preview` and `POST /capabilities/import/preview` in `server.rs` with the import route's authorization; verify with integration tests in `tests/spreadsheet_import.rs`: German shift headers (`Bezeichnung`, `Kürzel`, `Farbe`), extra columns ignored, title rows with correct error row numbers, an explicit mapping for an unknown header, refusal naming `short_name`/`color` when unmappable, and a preview that creates nothing
- [x] 2.3 Document the preview operations and the `mapping`/`sheet` parts for shifts and capabilities in `api/openapi.yaml` (replace "Rows follow the columns from …" with header-based wording); verify the YAML still parses

## 3. Workstations and employees

- [x] 3.1 Declare `FIELDS` for workstations and employees, build templates from them (header rows unchanged), port both importers to mapped rows, and add their preview routes; verify with integration tests: reordered `email`/`name`, a workstation file with only `name` gets the defaults, and ambiguous `Name`+`Bezeichnung` is refused
- [x] 3.2 Move the old-hours guard to check every normalised header (`maxworkinghours`, `monthlyworkinghours`), both with and without a mapping; verify that the existing `the_import_takes_weekly_hours_and_refuses_an_old_template` test still passes and that new tests cover the old column in position 1 and a mapping pointing `weekly_working_hours` at it
- [x] 3.3 Accept `ja`/`nein` for workstation `available`; verify with an integration test
- [x] 3.4 Document the workstation and employee preview operations and the mapping in `api/openapi.yaml`; verify the YAML still parses and `make test` passes (YAML parses with every `$ref` resolved; every suite that touches imports passes, but `make test` as a whole does not: `audit_log`, `info`, `rotation_patterns`, `shift_weekday_times` and `wish_window` fail with 503 "Token verification is not configured" because they build the app without a token verifier, which `tenant.rs` has required since before this change)

## 4. UI import dialog

- [x] 4.1 Add `previewImport(file, sheet?)` to the shift, capability, workstation and employee services, plus an optional `mapping` on `importFromFile`, with `ImportPreview` / `ImportMapping` types; verify with service specs that the multipart parts are sent
- [x] 4.2 Build `shared/components/import-dialog` on `app-modal`: sheet select (re-previews), a column table with header, samples and field select (choosing a field clears it on any other column), missing/ambiguous fields named, and Import disabled until each required field is set exactly once, with `data-testid`s; verify with a component spec covering the disabled state, reassigning a field and cancel
- [x] 4.3 Wire the dialog into the Shifts, Capabilities, Workstations and Employees (user-profiles) pages in place of the direct upload, extend `accept` to `.xlsx,.xls,.xlsb,.ods`, keep the result banner, and add `import.*` keys to `de.ts` and `en.ts`; verify that `cd ui && npm run build` and the page specs pass
- [x] 4.4 Add a Robot e2e case under `e2e/tests/settings/` that imports a reordered capability sheet through the dialog; verify with `cd e2e && make dryrun`

## 5. Integration check

- [ ] 5.1 Against a running stack, import a hand-made employee sheet with German headers, a title row and a cover sheet through the dialog, and confirm that the employees, the error row numbers and the audit log entry are correct
