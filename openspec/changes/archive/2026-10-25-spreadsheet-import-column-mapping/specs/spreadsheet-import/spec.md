# Spec Delta

## Purpose

Import master data (shifts, capabilities, workstations, employees) from spreadsheets laid out in whatever way the source used: columns are recognised by their header, and the user confirms or corrects that interpretation before anything is written.

## ADDED Requirements

### Requirement: Columns by header
The shift, capability, workstation and employee imports SHALL read each field from the column whose header matches it, never by position. Matching SHALL ignore case, surrounding whitespace, spaces, underscores, hyphens and dots, and SHALL accept each field's template name plus fixed English and German aliases. Columns matching no field SHALL be ignored.

#### Scenario: Reordered columns
- **WHEN** an employee sheet has the headers `email`, `name` in that order
- **THEN** each row's employee gets the name from the `name` column and the email from the `email` column

#### Scenario: German headers
- **WHEN** a shift sheet has the headers `Bezeichnung`, `Kürzel`, `Farbe`
- **THEN** they are read as `name`, `short_name` and `color`

#### Scenario: Extra columns
- **WHEN** a capability sheet has the headers `ID`, `Name`, `Kommentar`
- **THEN** only `Name` is read and the other columns are ignored

#### Scenario: Current template
- **WHEN** a file built from the current template is imported
- **THEN** it imports exactly as it did before this change

### Requirement: Header row detection
The import SHALL look for the header row among the first 10 rows of the sheet and take the row that matches the most fields. Rows above it SHALL be ignored, and data SHALL start on the row after it. Row numbers in import errors SHALL be the spreadsheet's own row numbers.

#### Scenario: Title rows above the header
- **WHEN** row 1 holds a title, row 2 is empty, and row 3 holds the headers
- **THEN** row 3 is the header, data starts on row 4, and an error in the first data row names row 4

### Requirement: Ambiguous headers
When two or more columns match the same field, the import SHALL map none of them to that field automatically and SHALL report the field as ambiguous.

#### Scenario: Two name columns
- **WHEN** a sheet has both `Name` and `Bezeichnung` columns and no mapping is given
- **THEN** `name` is reported as ambiguous and neither column is read as `name`

### Requirement: Import preview
Each of the four imports SHALL offer a preview that takes the same file and writes nothing. It returns the workbook's sheet names, the sheet and header row used, every column with its header, up to 5 sample values and the field it maps to (or none), the importable fields with which are required, the required fields still unmapped, the ambiguous fields, and the number of data rows.

#### Scenario: Preview of a reordered file
- **WHEN** a planner previews an employee file with headers `E-Mail`, `Name`, `Wochenstunden`
- **THEN** the response maps column 1 to `email`, column 2 to `name` and column 3 to `weekly_working_hours`, lists no missing required fields, and no employee is created

#### Scenario: Preview of another sheet
- **WHEN** a preview names a sheet other than the first
- **THEN** detection runs on that sheet and the response says which sheet was used

### Requirement: User-assigned mapping
The import SHALL accept an optional mapping giving the sheet, the header row and, for each field, the column to read it from. When a mapping is given, the import SHALL use it instead of detection. A field the mapping leaves out SHALL be treated as an absent column. A mapping that names a nonexistent sheet or column, or assigns one column to two fields, SHALL be refused with 400.

#### Scenario: Header the aliases do not know
- **WHEN** a shift sheet's color column is headed `Anzeige` and the mapping assigns it to `color`
- **THEN** the shifts get their colors from that column

#### Scenario: Mapping overrides detection
- **WHEN** detection maps a column to `name` but the mapping assigns a different column to `name`
- **THEN** names are read from the column the mapping names

#### Scenario: Invalid mapping
- **WHEN** a mapping assigns the same column to `name` and `email`
- **THEN** the import is refused with 400 and nothing is created

### Requirement: Unmappable file refused
An import whose required fields are not all mapped to exactly one column SHALL be refused as a whole with 400, naming each missing or ambiguous field. Nothing SHALL be created. The required fields are: shifts `name`, `short_name`, `color`; capabilities `name`; workstations `name`; employees `name`, `email`.

#### Scenario: No recognisable header
- **WHEN** an employee file without a header row is imported without a mapping
- **THEN** the import is refused with 400 naming `name` and `email`, and no employee is created

#### Scenario: Optional field absent
- **WHEN** a workstation file has only a `name` column
- **THEN** the workstations are created with the defaults for every other field

### Requirement: Outdated employee hours columns
The employee import SHALL refuse a file with a `max_working_hours` or `monthly_working_hours` column in any position, naming `weekly_working_hours`, and SHALL never map those columns to `weekly_working_hours`, whether by detection or through a mapping.

#### Scenario: Old column moved
- **WHEN** an employee file has `monthly_working_hours` as its first column
- **THEN** the import is refused with 400 naming `weekly_working_hours` and no employee is created

#### Scenario: Old column assigned in a mapping
- **WHEN** a mapping assigns a column headed `max_working_hours` to `weekly_working_hours`
- **THEN** the import is refused with 400 and no employee is created

### Requirement: Accepted file formats
The imports and previews SHALL accept `.xlsx`, `.xls`, `.xlsb` and `.ods` workbooks and SHALL tell them apart by content, not by file name. Any other file SHALL be refused with 400.

#### Scenario: OpenDocument spreadsheet
- **WHEN** a capability list saved as `.ods` is imported
- **THEN** its capabilities are created as from an equivalent `.xlsx`

#### Scenario: Not a workbook
- **WHEN** a PDF is uploaded to an import
- **THEN** the import is refused with 400 saying the file could not be read as a spreadsheet

### Requirement: Import dialog
On the Shifts, Capabilities, Workstations and Employees pages, choosing a file to import SHALL open a dialog showing the preview: one line per column with its header, sample values and a field selector set to the detected field. The user SHALL be able to change the sheet, reassign or clear any column's field, and import only once every required field is assigned exactly once. Any unmapped required field SHALL be named in the dialog.

#### Scenario: Correcting a guess
- **WHEN** a planner opens the dialog for a file whose `Station` column was not recognised, assigns it to `name` and imports
- **THEN** the import uses that mapping and the page shows the usual created/skipped result

#### Scenario: Required field missing
- **WHEN** the dialog's mapping leaves `email` unassigned for an employee import
- **THEN** the import button is disabled and the dialog names `email` as missing

#### Scenario: Cancel
- **WHEN** the planner closes the dialog without importing
- **THEN** nothing is created
