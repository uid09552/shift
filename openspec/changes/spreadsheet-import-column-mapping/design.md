# Design

## Context

All four master-data imports share `src/services/xlsx_io.rs`.
`extract_uploaded_file` pulls the `file` part out of the multipart upload,
`parse_rows` reads the first sheet with calamine's `Xlsx` reader and drops row 1
unread, and each importer then indexes `row.get(n)`. The template headers are a
separate string list in each `download_template`. The employee importer is the
only one that looks at the header, and only to refuse an old hours column at
index 2. Tests for imports live in `tests/weekly_hours.rs` (built with
`rust_xlsxwriter`, uploaded with `app.upload`). The UI posts the file directly
from a hidden `<input type=file accept=".xlsx">` on each of the four list pages
and shows `ImportResult` in a banner.

## Goals / Non-Goals

**Goals:**
- One shared detection and mapping engine. Each importer only declares its fields
  and consumes values by field key.
- Template headers, detection aliases and required flags come from one
  declaration per entity, so they cannot drift.
- Stateless server: preview and import are independent requests.

**Non-Goals:**
- Changing row validation, defaults or duplicate handling inside the importers.
- Any persistence of mappings.

## Decisions

### 1. Field declarations per entity

```rust
pub struct ImportField {
    pub key: &'static str,          // "short_name" - template header and API key
    pub required: bool,
    pub aliases: &'static [&'static str], // "kuerzel", "kurzname", "abbreviation", ...
}
```

Each service holds a `const FIELDS: &[ImportField]`. `download_template` builds
its header row from the `key`s in order, so templates stay byte-for-byte as they
are today. Aliases are stored already normalised (see decision 2).

Alias lists (initial set, extended as files turn up):

| entity | field | aliases (normalised) |
|---|---|---|
| shift, capability, workstation | name | name, bezeichnung, titel, title |
| employee | name | name, mitarbeiter, mitarbeiterin, employee, fullname |
| shift | short_name | shortname, kuerzel, kurzname, abbreviation, abkuerzung, code |
| shift | color | color, colour, farbe |
| shift | order | order, reihenfolge, sortierung, position |
| workstation | priority | priority, prioritaet |
| workstation | min_employees | minemployees, min, minimum, mindestbesetzung |
| workstation | max_employees | maxemployees, max, maximum, hoechstbesetzung |
| workstation | available | available, verfuegbar, aktiv, active |
| workstation | active_shifts | activeshifts, shifts, schichten |
| workstation | required_capabilities | requiredcapabilities, capabilities, faehigkeiten, qualifikationen |
| employee | email | email, mail, emailadresse |
| employee | weekly_working_hours | weeklyworkinghours, weeklyhours, wochenstunden, stundenprowoche, hours |
| employee | capabilities | capabilities, skills, faehigkeiten, qualifikationen |
| employee | available_shifts | availableshifts, shifts, schichten |

Within one entity an alias belongs to one field only. A test asserts this for
every entity, and that every alias is already in normalised form.

An employee's `name` takes no `titel`/`title` alias: on a staff list that column
is usually an academic title (Dr., Prof.), and reading it as the person's name
would be exactly the silent misread this change removes. A sheet with both a
`Name` and a `Titel` column imports with the name from `Name`.

*Alternative considered:* a fuzzy match such as Levenshtein distance or
contains-checks. Rejected because matches like `max` → `max_employees` versus
`Max Mustermann` turn into silent misreads, which is the bug this change removes.
Exact alias matching plus a user mapping is predictable.

### 2. Normalisation

`normalize(h)`: trim, lowercase, fold `ä→ae ö→oe ü→ue ß→ss` (and strip other
diacritics), then remove everything that is not `[a-z0-9]`. `"E-Mail"`,
`"e_mail"` and `"EMail "` all become `email`. `"Kürzel"` and `"Kuerzel"` both
become `kuerzel`.

### 3. Header row detection

Scan rows 0 to 9. For each row, count how many distinct fields its cells match.
Pick the row with the highest count, and take the first such row on a tie. If no
row matches anything, the header row is 0, nothing is mapped, and the required
fields are reported missing. That way a header-less file still previews, and the
user maps it by column letter in the dialog.

### 4. Detection result

```rust
pub struct Detection {
    pub sheet: String,
    pub header_row: usize,                      // 0-based internally
    pub mapping: HashMap<&'static str, usize>,  // field key -> column index
    pub ambiguous: Vec<&'static str>,
    pub missing_required: Vec<&'static str>,
}
```

A field matched by two or more columns goes to `ambiguous` and stays out of
`mapping` (spec: *Ambiguous headers*). `resolve(bytes, fields, Option<Mapping>)`
returns either a `Detection` or a `Validation` error. With an explicit mapping it
checks that the sheet exists, the columns exist and no column is used twice, then
takes the mapping verbatim.

### 5. Mapped rows API for importers

Importers stop indexing by position:

```rust
let table = xlsx_io::read_mapped(&bytes, FIELDS, mapping)?;   // refuses if required unmapped
for row in table.rows() {           // row.number() = real spreadsheet row (1-based)
    let name = row.get("name");     // "" when column absent or cell empty
    ...
}
```

Each importer's loop body stays the same apart from `row.get(key)` replacing
`row.get(n)` and `row.number()` replacing `idx + 2`. That keeps the diff small
and the existing validation untouched.

### 6. Endpoints and wire format

- `POST /{entity}/import/preview` takes multipart `file` and an optional `sheet`
  text part, and returns:

  ```json
  {
    "sheets": ["Mitarbeiter", "Info"],
    "sheet": "Mitarbeiter",
    "header_row": 3,
    "row_count": 42,
    "fields": [{"key": "name", "required": true}, ...],
    "columns": [{"index": 0, "header": "E-Mail", "field": "email", "samples": ["a@x.de", "..."]}, ...],
    "missing_required": [],
    "ambiguous": []
  }
  ```

  `header_row` is 1-based on the wire, matching what users see in Excel and the
  row numbers in `ImportResult`.
- `POST /{entity}/import` takes multipart `file` and an optional `mapping` text
  part holding `{"sheet": "...", "header_row": 3, "columns": {"name": 1, "email": 0}}`.
  The response is unchanged (`ImportResult`).
- Both use the same route-level authorization as the existing import route.

*Alternative considered:* parse the workbook in the browser with SheetJS and send
JSON rows, as the roster import does. Rejected because it adds a heavy UI
dependency and a second parser, and the four import endpoints would need a second
JSON variant. Uploading twice (preview, then import) is cheap for master-data
files of a few hundred rows.

*Alternative considered:* the server keeps the uploaded file under an import ID
between preview and commit. Rejected because it brings state, expiry and
multi-instance concerns for no real gain at these file sizes.

### 7. Reading other formats

Replace `open_workbook_from_rs::<Xlsx<_>>` with calamine's
`open_workbook_auto_from_rs`. It sniffs the content (zip → xlsx/xlsb/ods,
OLE → xls). Cell-to-string conversion stays as it is today. Numbers that Excel
stores as floats (`40` → `"40"`) already go through `Data::to_string`. The new
formats are covered by tests.

### 8. Employee old-hours guard

`OLD_HOURS_COLUMNS` is checked against the **normalised header of every column**
on the header row (`maxworkinghours`, `monthlyworkinghours`). That check runs
before detection and also when a mapping is given. The old names are not aliases
of any field, so they can never be auto-mapped. A mapping that points
`weekly_working_hours` at such a column is caught by the same check.

### 9. UI: shared import dialog

`shared/components/import-dialog/import-dialog.component.ts` builds on the
existing `app-modal`. Inputs are the entity's preview and import functions and a
translation prefix for field labels. Flow:

```
 file chosen --> preview() --> dialog open
                                 |  sheet <select>  -> preview(sheet)
                                 |  table: header | samples | field <select>
                                 |  missing/ambiguous fields named
                                 v
                         [Import] (enabled when every required field set once)
                                 |
                                 v
                    import(file, mapping) --> close, page shows ImportResult
```

Choosing a field that another column already holds clears it on that other
column, so a field is never assigned twice. Each service (`shift.service.ts`,
`capability`, `workstation`, `employee`) gains `previewImport(file, sheet?)`, and
`importFromFile(file, mapping?)` gains the mapping. The file input's `accept`
becomes `.xlsx,.xls,.xlsb,.ods`. Field labels are new i18n keys under `import.*`
in `de.ts` and `en.ts`. Elements carry `data-testid` for e2e.

## Risks / Trade-offs

- [Header-less files that imported positionally are now refused] → They are
  refused with a message, never misread. The dialog lets the user map them in
  seconds. Templates always had headers, so this only affects hand-made files.
- [A generic alias (`shifts`, `capabilities`, `max`) collides with a header that
  means something else] → Aliases are per entity, and the preview always shows
  the interpretation before the UI imports. Direct API callers without a mapping
  get the detected one, the same as the template.
- [`.xls`/`.ods` cell types differ (dates, booleans)] → No importer reads date
  cells today. Booleans for `available` go through the existing
  `true/yes/1` parsing, and `ja`/`nein` are added there while we are at it.
- [The file is uploaded twice] → Acceptable at master-data sizes. The existing
  body limit applies to both requests.

## Migration Plan

No data migration. Deploy backend and UI together: the old UI keeps working
against the new backend, because a template file without a mapping imports as
before. Rollback means reverting both. Nothing persistent changes.
