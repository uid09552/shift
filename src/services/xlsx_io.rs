use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Cursor;

use axum::body::Bytes;
use axum::extract::Multipart;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use calamine::{open_workbook_auto_from_rs, Data, Reader};
use rust_xlsxwriter::{Format, Workbook};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;

/// Builds an empty `.xlsx` template with a single bold header row.
pub fn build_template(headers: &[&str]) -> Result<Vec<u8>, AppError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    let header_format = Format::new().set_bold();

    for (col, header) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col as u16, *header, &header_format)
            .map_err(|_| AppError::Internal)?;
        worksheet
            .set_column_width(col as u16, header.len().max(12) as f64 + 2.0)
            .map_err(|_| AppError::Internal)?;
    }

    workbook.save_to_buffer().map_err(|_| AppError::Internal)
}

/// The import template for `fields`: one bold header per field, in declaration
/// order — the same list the import reads by, so the two cannot drift.
pub fn template_for(fields: &[ImportField]) -> Result<Vec<u8>, AppError> {
    let headers: Vec<&str> = fields.iter().map(|f| f.key).collect();
    build_template(&headers)
}

/// Wraps generated `.xlsx` bytes in a download response with the right headers.
pub fn xlsx_download_response(bytes: Vec<u8>, filename: &str) -> Response {
    (
        [
            (
                header::CONTENT_TYPE,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        Bytes::from(bytes),
    )
        .into_response()
}

/// The header row of the first worksheet, lower-cased — for imports that must
/// tell an outdated template from the current one.
pub fn parse_header(bytes: &[u8]) -> Result<Vec<String>, AppError> {
    Ok(read_sheet(bytes, None)?
        .rows
        .into_iter()
        .next()
        .unwrap_or_default()
        .into_iter()
        .map(|cell| cell.to_lowercase())
        .collect())
}

/// One worksheet as text, with every cell at its real position: a sheet whose
/// first rows or columns are empty still starts at row 1, column A.
pub struct SheetData {
    pub name: String,
    /// Every sheet in the workbook, in order.
    pub names: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

impl SheetData {
    /// Widest row: the number of columns the sheet spans.
    fn width(&self) -> usize {
        self.rows.iter().map(Vec::len).max().unwrap_or(0)
    }
}

const NOT_A_WORKBOOK: &str = "Could not read the uploaded file as a spreadsheet (.xlsx, .xls, .xlsb or .ods)";

/// Reads `wanted` (the first sheet when `None`) of a workbook in any of the
/// formats calamine recognises. The format is taken from the content, never
/// from a file name.
pub fn read_sheet(bytes: &[u8], wanted: Option<&str>) -> Result<SheetData, AppError> {
    let mut workbook =
        open_workbook_auto_from_rs(Cursor::new(bytes)).map_err(|_| AppError::Validation(NOT_A_WORKBOOK.into()))?;

    let names = workbook.sheet_names();
    let name = match wanted {
        Some(w) => names
            .iter()
            .find(|n| n.as_str() == w)
            .cloned()
            .ok_or_else(|| AppError::Validation(format!("The workbook has no sheet '{w}'")))?,
        None => names
            .first()
            .cloned()
            .ok_or_else(|| AppError::Validation("Uploaded workbook has no sheets".into()))?,
    };

    let range = workbook
        .worksheet_range(&name)
        .map_err(|_| AppError::Validation("Could not read worksheet".into()))?;

    // `Range` starts at the first non-empty cell; put the empty rows and
    // columns before it back so positions are the ones the user sees.
    let (first_row, first_col) = range.start().map_or((0, 0), |(r, c)| (r as usize, c as usize));
    let mut rows: Vec<Vec<String>> = vec![Vec::new(); first_row];
    rows.extend(range.rows().map(|row| {
        let mut cells = vec![String::new(); first_col];
        cells.extend(row.iter().map(|cell| match cell {
            Data::Empty => String::new(),
            other => other.to_string().trim().to_string(),
        }));
        cells
    }));

    Ok(SheetData { name, names, rows })
}

/// A spreadsheet upload: the `file`, and optionally the `sheet` to read and the
/// `mapping` the user assigned, both as text parts.
pub struct Upload {
    pub file: Vec<u8>,
    pub sheet: Option<String>,
    pub mapping: Option<ColumnMapping>,
}

pub async fn extract_upload(mut multipart: Multipart) -> Result<Upload, AppError> {
    let mut file = None;
    let mut sheet = None;
    let mut mapping = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::Validation("Invalid multipart upload".into()))?
    {
        match field.name() {
            Some("file") if file.is_none() => {
                let data = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::Validation("Could not read uploaded file".into()))?;
                file = Some(data.to_vec());
            }
            Some("sheet") => {
                let text = field
                    .text()
                    .await
                    .map_err(|_| AppError::Validation("Could not read the 'sheet' part".into()))?;
                sheet = Some(text).filter(|t| !t.trim().is_empty());
            }
            Some("mapping") => {
                let text = field
                    .text()
                    .await
                    .map_err(|_| AppError::Validation("Could not read the 'mapping' part".into()))?;
                mapping = Some(
                    serde_json::from_str::<ColumnMapping>(&text)
                        .map_err(|e| AppError::Validation(format!("Invalid 'mapping': {e}")))?,
                );
            }
            _ => {}
        }
    }
    Ok(Upload {
        file: file.ok_or_else(|| AppError::Validation("Missing 'file' field in upload".into()))?,
        sheet,
        mapping,
    })
}

/// Splits a comma-separated cell value into trimmed, non-empty names.
pub fn split_names(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(serde::Serialize)]
pub struct ImportRowError {
    pub row: usize,
    pub message: String,
}

#[derive(serde::Serialize, Default)]
pub struct ImportResult {
    pub created: usize,
    pub skipped: usize,
    pub errors: Vec<ImportRowError>,
}

impl ImportResult {
    pub fn push_error(&mut self, row: usize, message: impl Into<String>) {
        self.skipped += 1;
        self.errors.push(ImportRowError {
            row,
            message: message.into(),
        });
    }
}

// ── Columns by header ───────────────────────────────────────────────────────
//
// An import declares its fields once (`ImportField`); the file's columns are
// matched to them by header, never by position, and the user can assign the
// ones that are not recognised.

/// One importable field of an entity. Its `key` is the template's header and the
/// name used on the wire; `aliases` are other headers that mean the same thing,
/// already [`normalize`]d. A header matches a field when it normalises to the
/// field's key or to one of its aliases.
#[derive(Debug, Clone, Copy)]
pub struct ImportField {
    pub key: &'static str,
    pub required: bool,
    pub aliases: &'static [&'static str],
}

impl ImportField {
    fn matches(&self, normalized: &str) -> bool {
        !normalized.is_empty() && (normalize(self.key) == normalized || self.aliases.contains(&normalized))
    }
}

/// The comparison form of a header: lower case, umlauts and ß spelled out
/// (`ä` → `ae`), other accents dropped, and everything that is not a letter or
/// digit removed — so `E-Mail`, `e_mail` and `EMail ` are one header, and
/// `Kürzel` equals `Kuerzel`.
pub fn normalize(header: &str) -> String {
    let mut out = String::with_capacity(header.len());
    for c in header.trim().chars().flat_map(char::to_lowercase) {
        match c {
            'ä' => out.push_str("ae"),
            'ö' => out.push_str("oe"),
            'ü' => out.push_str("ue"),
            'ß' => out.push_str("ss"),
            'à' | 'á' | 'â' | 'ã' | 'å' => out.push('a'),
            'è' | 'é' | 'ê' | 'ë' => out.push('e'),
            'ì' | 'í' | 'î' | 'ï' => out.push('i'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ø' => out.push('o'),
            'ù' | 'ú' | 'û' => out.push('u'),
            'ý' | 'ÿ' => out.push('y'),
            'ç' => out.push('c'),
            'ñ' => out.push('n'),
            // A decomposed umlaut (a, o or u + combining diaeresis), as macOS writes them.
            '\u{0308}' => {
                if matches!(out.chars().last(), Some('a' | 'o' | 'u')) {
                    out.push('e');
                }
            }
            c if c.is_ascii_alphanumeric() => out.push(c),
            _ => {}
        }
    }
    out
}

/// What the user assigned in the import dialog. Whatever it leaves out is not
/// guessed: a field it does not name has no column.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnMapping {
    /// The sheet to read; the first when absent.
    pub sheet: Option<String>,
    /// The header row, counted from 1 as a spreadsheet does; detected when absent.
    pub header_row: Option<usize>,
    /// Field key → 0-based column.
    #[serde(default)]
    pub columns: HashMap<String, usize>,
}

/// How a sheet's columns map to an entity's fields.
#[derive(Debug)]
pub struct Detection {
    /// 0-based; `header_row + 1` is the row the user sees.
    pub header_row: usize,
    pub mapping: BTreeMap<&'static str, usize>,
    /// Fields several columns claim: none of them is read for it.
    pub ambiguous: Vec<&'static str>,
    pub missing_required: Vec<&'static str>,
}

/// How far down a header may be, to skip titles and notes above it.
const HEADER_SEARCH_ROWS: usize = 10;

/// Columns of `row` that match each field.
fn header_matches(row: &[String], fields: &[ImportField]) -> BTreeMap<&'static str, Vec<usize>> {
    let mut found: BTreeMap<&'static str, Vec<usize>> = BTreeMap::new();
    for (column, cell) in row.iter().enumerate() {
        let normalized = normalize(cell);
        for field in fields.iter().filter(|f| f.matches(&normalized)) {
            found.entry(field.key).or_default().push(column);
        }
    }
    found
}

/// Finds the header row — the one among the first rows that matches the most
/// fields, the topmost on a tie, row 0 when none matches — and maps its columns.
pub fn detect(rows: &[Vec<String>], fields: &[ImportField]) -> Detection {
    let mut best: (usize, BTreeMap<&'static str, Vec<usize>>) = (0, BTreeMap::new());
    for (index, row) in rows.iter().take(HEADER_SEARCH_ROWS).enumerate() {
        let found = header_matches(row, fields);
        if found.len() > best.1.len() {
            best = (index, found);
        }
    }
    let (header_row, found) = best;

    let mut mapping = BTreeMap::new();
    let mut ambiguous = Vec::new();
    for field in fields {
        match found.get(field.key).map(Vec::as_slice) {
            Some([only]) => {
                mapping.insert(field.key, *only);
            }
            Some([_, _, ..]) => ambiguous.push(field.key),
            _ => {}
        }
    }
    let missing_required = missing_required(fields, &mapping);
    Detection { header_row, mapping, ambiguous, missing_required }
}

fn missing_required(fields: &[ImportField], mapping: &BTreeMap<&'static str, usize>) -> Vec<&'static str> {
    fields.iter().filter(|f| f.required && !mapping.contains_key(f.key)).map(|f| f.key).collect()
}

/// The detection, or — when the user assigned columns — that assignment taken as
/// given. An assignment that does not fit the sheet is refused, not repaired.
pub fn resolve(
    sheet: &SheetData,
    fields: &[ImportField],
    requested: Option<&ColumnMapping>,
) -> Result<Detection, AppError> {
    let detected = detect(&sheet.rows, fields);
    let Some(requested) = requested else {
        return Ok(detected);
    };

    let header_row = match requested.header_row {
        None => detected.header_row,
        Some(row) if (1..=sheet.rows.len().max(1)).contains(&row) => row - 1,
        Some(row) => {
            return Err(AppError::Validation(format!(
                "Header row {row} is outside the sheet '{}' ({} rows)",
                sheet.name,
                sheet.rows.len()
            )))
        }
    };

    let width = sheet.width();
    let mut mapping = BTreeMap::new();
    let mut taken: BTreeSet<usize> = BTreeSet::new();
    // Sorted, so the same bad assignment always gets the same message.
    let mut assigned: Vec<(&String, &usize)> = requested.columns.iter().collect();
    assigned.sort();
    for (key, &column) in assigned {
        let field = fields
            .iter()
            .find(|f| f.key == key.as_str())
            .ok_or_else(|| AppError::Validation(format!("The mapping names an unknown field '{key}'")))?;
        if column >= width {
            return Err(AppError::Validation(format!(
                "The mapping puts '{key}' in column {} but the sheet has {width}",
                column + 1
            )));
        }
        if !taken.insert(column) {
            return Err(AppError::Validation(format!(
                "Column {} is assigned to more than one field",
                column + 1
            )));
        }
        mapping.insert(field.key, column);
    }
    let missing_required = missing_required(fields, &mapping);
    Ok(Detection { header_row, mapping, ambiguous: Vec::new(), missing_required })
}

/// One data row, read by field.
pub struct MappedRow {
    number: usize,
    values: HashMap<&'static str, String>,
}

impl MappedRow {
    /// The row's number in the spreadsheet, from 1 — what an error should name.
    pub fn number(&self) -> usize {
        self.number
    }

    /// The trimmed cell for `key`; empty when the cell is, or the field has no column.
    pub fn get(&self, key: &str) -> &str {
        self.values.get(key).map_or("", String::as_str)
    }
}

/// The data rows of a sheet, read through a [`Detection`].
pub struct MappedTable {
    /// The header row's cells as written, every column — for checks the field
    /// mapping does not cover.
    pub headers: Vec<String>,
    rows: Vec<MappedRow>,
}

impl MappedTable {
    pub fn rows(&self) -> &[MappedRow] {
        &self.rows
    }
}

fn data_rows(sheet: &SheetData, header_row: usize) -> impl Iterator<Item = (usize, &Vec<String>)> {
    sheet
        .rows
        .iter()
        .enumerate()
        .skip(header_row + 1)
        .filter(|(_, row)| row.iter().any(|cell| !cell.is_empty()))
        .map(|(index, row)| (index + 1, row))
}

/// Reads an upload's data rows by field. Refuses, naming them, when a required
/// field has no column or several claim it: nothing is read by guesswork.
pub fn read_mapped(
    bytes: &[u8],
    fields: &[ImportField],
    requested: Option<&ColumnMapping>,
) -> Result<MappedTable, AppError> {
    let sheet = read_sheet(bytes, requested.and_then(|m| m.sheet.as_deref()))?;
    let detection = resolve(&sheet, fields, requested)?;

    let mut problems = Vec::new();
    if !detection.missing_required.is_empty() {
        problems.push(format!("no column found for {}", detection.missing_required.join(", ")));
    }
    let ambiguous: Vec<_> = detection.ambiguous.iter().filter(|k| fields.iter().any(|f| f.required && f.key == **k)).collect();
    if !ambiguous.is_empty() {
        problems.push(format!(
            "several columns match {}",
            ambiguous.iter().map(|k| **k).collect::<Vec<_>>().join(", ")
        ));
    }
    if !problems.is_empty() {
        return Err(AppError::Validation(format!(
            "The columns could not be matched: {}. Name them in the header row or assign them in the import dialog",
            problems.join("; ")
        )));
    }

    let rows = data_rows(&sheet, detection.header_row)
        .map(|(number, cells)| MappedRow {
            number,
            values: detection
                .mapping
                .iter()
                .map(|(key, &column)| (*key, cells.get(column).cloned().unwrap_or_default()))
                .collect(),
        })
        .collect();
    Ok(MappedTable { headers: sheet.rows.get(detection.header_row).cloned().unwrap_or_default(), rows })
}

// ── Preview ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PreviewField {
    pub key: &'static str,
    pub required: bool,
}

#[derive(Debug, Serialize)]
pub struct PreviewColumn {
    pub index: usize,
    pub header: String,
    /// The field this column is read as, or none.
    pub field: Option<&'static str>,
    pub samples: Vec<String>,
}

/// What an upload looks like and how it would be read — nothing is written.
#[derive(Debug, Serialize)]
pub struct ImportPreview {
    pub sheets: Vec<String>,
    pub sheet: String,
    /// Counted from 1, as in the spreadsheet.
    pub header_row: usize,
    pub row_count: usize,
    pub fields: Vec<PreviewField>,
    pub columns: Vec<PreviewColumn>,
    pub missing_required: Vec<&'static str>,
    pub ambiguous: Vec<&'static str>,
}

const SAMPLES_PER_COLUMN: usize = 5;

pub fn preview(bytes: &[u8], fields: &[ImportField], sheet: Option<&str>) -> Result<ImportPreview, AppError> {
    let data = read_sheet(bytes, sheet)?;
    let detection = detect(&data.rows, fields);
    let field_of: HashMap<usize, &'static str> = detection.mapping.iter().map(|(k, &c)| (c, *k)).collect();
    let data_rows: Vec<&Vec<String>> = data_rows(&data, detection.header_row).map(|(_, row)| row).collect();
    let header = data.rows.get(detection.header_row);

    let columns = (0..data.width())
        .filter_map(|index| {
            let header = header.and_then(|row| row.get(index)).cloned().unwrap_or_default();
            let samples: Vec<String> = data_rows
                .iter()
                .filter_map(|row| row.get(index).filter(|cell| !cell.is_empty()).cloned())
                .take(SAMPLES_PER_COLUMN)
                .collect();
            // A column with nothing in it is not worth a line.
            (!header.is_empty() || !samples.is_empty())
                .then(|| PreviewColumn { index, header, field: field_of.get(&index).copied(), samples })
        })
        .collect();

    Ok(ImportPreview {
        sheets: data.names.clone(),
        sheet: data.name.clone(),
        header_row: detection.header_row + 1,
        row_count: data_rows.len(),
        fields: fields.iter().map(|f| PreviewField { key: f.key, required: f.required }).collect(),
        columns,
        missing_required: detection.missing_required,
        ambiguous: detection.ambiguous,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIELDS: &[ImportField] = &[
        ImportField { key: "name", required: true, aliases: &["bezeichnung"] },
        ImportField { key: "email", required: true, aliases: &["mail", "emailadresse"] },
        ImportField { key: "hours", required: false, aliases: &["stunden"] },
    ];

    fn workbook(sheets: &[(&str, &[&[&str]])]) -> Vec<u8> {
        let mut book = Workbook::new();
        for (name, rows) in sheets {
            let sheet = book.add_worksheet();
            sheet.set_name(*name).unwrap();
            for (r, row) in rows.iter().enumerate() {
                for (c, cell) in row.iter().enumerate() {
                    if !cell.is_empty() {
                        sheet.write_string(r as u32, c as u16, *cell).unwrap();
                    }
                }
            }
        }
        book.save_to_buffer().unwrap()
    }

    fn one_sheet(rows: &[&[&str]]) -> Vec<u8> {
        workbook(&[("Sheet1", rows)])
    }

    fn rows_of(rows: &[&[&str]]) -> Vec<Vec<String>> {
        rows.iter().map(|r| r.iter().map(|c| c.to_string()).collect()).collect()
    }

    fn refusal(result: Result<impl Sized, AppError>) -> String {
        match result {
            Err(AppError::Validation(message)) => message,
            Err(_) => panic!("expected a validation error"),
            Ok(_) => panic!("expected the file to be refused"),
        }
    }

    // ── normalize ───────────────────────────────────────────────────────────

    #[test]
    fn headers_that_differ_only_in_case_spacing_or_punctuation_are_one_header() {
        for header in ["E-Mail", "e_mail", "EMail ", " e.mail", "E Mail"] {
            assert_eq!(normalize(header), "email", "{header:?}");
        }
    }

    #[test]
    fn umlauts_are_spelled_out_and_other_accents_dropped() {
        assert_eq!(normalize("Kürzel"), "kuerzel");
        assert_eq!(normalize("Kuerzel"), "kuerzel");
        assert_eq!(normalize("Straße"), "strasse");
        assert_eq!(normalize("Qualifikationen für Ärzte"), "qualifikationenfueraerzte");
        assert_eq!(normalize("Café"), "cafe");
    }

    #[test]
    fn a_decomposed_umlaut_reads_like_the_precomposed_one() {
        assert_eq!(normalize("Ku\u{0308}rzel"), "kuerzel");
        assert_eq!(normalize("Ku\u{0308}rzel"), normalize("Kürzel"));
    }

    // ── reading ─────────────────────────────────────────────────────────────

    #[test]
    fn an_ods_file_gives_the_same_rows_as_the_equivalent_xlsx() {
        let ods = include_bytes!("../../tests/fixtures/capabilities.ods");
        let xlsx = workbook(&[("Capabilities", &[&["Name", "Level"], &["Intensive Care", "1"], &["Emergency Room", "2"]])]);
        let from_ods = read_sheet(ods, None).unwrap();
        let from_xlsx = read_sheet(&xlsx, None).unwrap();
        assert_eq!(from_ods.rows, from_xlsx.rows);
        assert_eq!(from_ods.name, "Capabilities");
    }

    #[test]
    fn a_file_that_is_not_a_workbook_is_refused() {
        let message = refusal(read_sheet(b"%PDF-1.7 not a spreadsheet", None));
        assert!(message.contains("spreadsheet"), "{message}");
    }

    #[test]
    fn a_named_sheet_is_read_and_an_unknown_one_refused() {
        let book = workbook(&[("Info", &[&["Cover"]]), ("Mitarbeiter", &[&["Name", "Email"], &["Anna", "a@x.de"]])]);
        let sheet = read_sheet(&book, Some("Mitarbeiter")).unwrap();
        assert_eq!(sheet.names, ["Info", "Mitarbeiter"]);
        assert_eq!(sheet.rows[1], ["Anna", "a@x.de"]);
        assert_eq!(read_sheet(&book, None).unwrap().name, "Info");
        assert!(refusal(read_sheet(&book, Some("Missing"))).contains("Missing"));
    }

    #[test]
    fn cells_keep_their_real_position_when_the_sheet_starts_below_and_right_of_a1() {
        let book = one_sheet(&[&[""], &[""], &["", "Name", "Email"], &["", "Anna", "a@x.de"]]);
        let sheet = read_sheet(&book, None).unwrap();
        assert_eq!(sheet.rows.len(), 4);
        assert_eq!(sheet.rows[2], ["", "Name", "Email"]);
        assert_eq!(sheet.rows[3][1], "Anna");
    }

    // ── detection ───────────────────────────────────────────────────────────

    #[test]
    fn columns_are_found_by_header_whatever_their_order() {
        let found = detect(&rows_of(&[&["email", "name"], &["a@x.de", "Anna"]]), FIELDS);
        assert_eq!((found.header_row, found.mapping["name"], found.mapping["email"]), (0, 1, 0));
        assert!(found.missing_required.is_empty() && found.ambiguous.is_empty());
    }

    #[test]
    fn aliases_in_german_are_recognised() {
        let found = detect(&rows_of(&[&["Bezeichnung", "E-Mail", "Stunden"]]), FIELDS);
        assert_eq!((found.mapping["name"], found.mapping["email"], found.mapping["hours"]), (0, 1, 2));
    }

    #[test]
    fn the_header_is_found_below_title_rows_and_extra_columns_are_ignored() {
        let rows = rows_of(&[&["Mitarbeiterliste 2026"], &[], &["Nr", "Name", "Kommentar", "Mail"], &["1", "Anna", "", "a@x.de"]]);
        let found = detect(&rows, FIELDS);
        assert_eq!(found.header_row, 2);
        assert_eq!((found.mapping["name"], found.mapping["email"]), (1, 3));
        assert_eq!(found.mapping.len(), 2);
    }

    #[test]
    fn the_row_matching_the_most_fields_is_the_header_and_the_topmost_wins_a_tie() {
        let rows = rows_of(&[&["Name"], &["Name", "Email"], &["Name", "Email"]]);
        assert_eq!(detect(&rows, FIELDS).header_row, 1);
        let tie = rows_of(&[&["Name", "Email"], &["Name", "Email"]]);
        assert_eq!(detect(&tie, FIELDS).header_row, 0);
    }

    #[test]
    fn two_columns_for_one_field_map_neither_and_name_the_field() {
        let found = detect(&rows_of(&[&["Name", "Bezeichnung", "Email"]]), FIELDS);
        assert_eq!(found.ambiguous, ["name"]);
        assert!(!found.mapping.contains_key("name"));
        assert_eq!(found.missing_required, ["name"]);
    }

    #[test]
    fn a_sheet_without_a_header_maps_nothing_and_misses_every_required_field() {
        let found = detect(&rows_of(&[&["Anna", "a@x.de"]]), FIELDS);
        assert_eq!(found.header_row, 0);
        assert!(found.mapping.is_empty());
        assert_eq!(found.missing_required, ["name", "email"]);
    }

    // ── explicit mapping ────────────────────────────────────────────────────

    fn mapping(columns: &[(&str, usize)]) -> ColumnMapping {
        ColumnMapping { columns: columns.iter().map(|(k, c)| (k.to_string(), *c)).collect(), ..Default::default() }
    }

    #[test]
    fn an_assignment_replaces_the_detected_columns() {
        let book = one_sheet(&[&["Name", "Anzeige"], &["Anna", "a@x.de"]]);
        let table = read_mapped(&book, FIELDS, Some(&mapping(&[("name", 1), ("email", 0)]))).unwrap();
        assert_eq!((table.rows()[0].get("name"), table.rows()[0].get("email")), ("a@x.de", "Anna"));
    }

    #[test]
    fn an_assignment_for_a_header_nothing_recognises_makes_the_file_readable() {
        let book = one_sheet(&[&["Station", "Kontakt"], &["Anna", "a@x.de"]]);
        assert!(read_mapped(&book, FIELDS, None).is_err());
        let table = read_mapped(&book, FIELDS, Some(&mapping(&[("name", 0), ("email", 1)]))).unwrap();
        assert_eq!(table.rows()[0].get("name"), "Anna");
    }

    #[test]
    fn a_field_the_assignment_leaves_out_has_no_column() {
        let book = one_sheet(&[&["Name", "Email", "Stunden"], &["Anna", "a@x.de", "30"]]);
        let table = read_mapped(&book, FIELDS, Some(&mapping(&[("name", 0), ("email", 1)]))).unwrap();
        assert_eq!(table.rows()[0].get("hours"), "");
    }

    #[test]
    fn an_assignment_that_does_not_fit_the_sheet_is_refused() {
        let book = one_sheet(&[&["Name", "Email"], &["Anna", "a@x.de"]]);
        let sheet = read_sheet(&book, None).unwrap();
        assert!(refusal(resolve(&sheet, FIELDS, Some(&mapping(&[("name", 5)])))).contains("column 6"));
        assert!(refusal(resolve(&sheet, FIELDS, Some(&mapping(&[("name", 0), ("email", 0)])))).contains("more than one field"));
        assert!(refusal(resolve(&sheet, FIELDS, Some(&mapping(&[("bogus", 0)])))).contains("bogus"));
        let far = ColumnMapping { header_row: Some(99), ..Default::default() };
        assert!(refusal(resolve(&sheet, FIELDS, Some(&far))).contains("99"));
        assert!(refusal(resolve(&sheet, FIELDS, Some(&ColumnMapping { header_row: Some(0), ..Default::default() }))).contains("Header row 0"));
    }

    #[test]
    fn a_mapping_naming_an_unknown_sheet_is_refused() {
        let book = one_sheet(&[&["Name", "Email"]]);
        let requested = ColumnMapping { sheet: Some("Nope".into()), ..Default::default() };
        assert!(refusal(read_mapped(&book, FIELDS, Some(&requested))).contains("Nope"));
    }

    // ── refusing and row numbers ────────────────────────────────────────────

    #[test]
    fn a_file_whose_required_columns_cannot_be_matched_is_refused_naming_them() {
        let book = one_sheet(&[&["Anna", "a@x.de"], &["Ben", "b@x.de"]]);
        let message = refusal(read_mapped(&book, FIELDS, None));
        assert!(message.contains("name, email"), "{message}");

        let ambiguous = one_sheet(&[&["Name", "Bezeichnung", "Email"], &["Anna", "Anna", "a@x.de"]]);
        let message = refusal(read_mapped(&ambiguous, FIELDS, None));
        assert!(message.contains("several columns match name"), "{message}");
    }

    #[test]
    fn an_optional_field_that_is_absent_or_ambiguous_does_not_block_the_import() {
        let book = one_sheet(&[&["Name", "Email", "Stunden", "Stunden"], &["Anna", "a@x.de", "30", "35"]]);
        let table = read_mapped(&book, FIELDS, None).unwrap();
        assert_eq!(table.rows()[0].get("hours"), "");
        assert_eq!(table.rows()[0].get("name"), "Anna");
    }

    #[test]
    fn rows_carry_their_spreadsheet_row_number_and_blank_rows_are_skipped() {
        let book = one_sheet(&[&["Staff"], &[], &["Name", "Email"], &["Anna", "a@x.de"], &[], &["Ben", "b@x.de"]]);
        let table = read_mapped(&book, FIELDS, None).unwrap();
        let numbered: Vec<_> = table.rows().iter().map(|r| (r.number(), r.get("name").to_string())).collect();
        assert_eq!(numbered, [(4, "Anna".to_string()), (6, "Ben".to_string())]);
        assert_eq!(table.headers, ["Name", "Email"]);
    }

    // ── preview ─────────────────────────────────────────────────────────────

    #[test]
    fn the_preview_describes_the_sheet_and_how_it_would_be_read() {
        let mut rows: Vec<Vec<String>> = vec![vec!["Staff".into()], vec![], vec!["E-Mail".into(), "Name".into(), "Notiz".into()]];
        for i in 0..7 {
            rows.push(vec![format!("p{i}@x.de"), format!("Person {i}"), String::new()]);
        }
        let cells: Vec<Vec<&str>> = rows.iter().map(|r| r.iter().map(String::as_str).collect()).collect();
        let slices: Vec<&[&str]> = cells.iter().map(Vec::as_slice).collect();
        let book = workbook(&[("Cover", &[&["Hello"]]), ("Staff", &slices)]);

        let preview = serde_json::to_value(preview(&book, FIELDS, Some("Staff")).unwrap()).unwrap();
        assert_eq!(preview["sheets"], serde_json::json!(["Cover", "Staff"]));
        assert_eq!(preview["sheet"], "Staff");
        assert_eq!(preview["header_row"], 3);
        assert_eq!(preview["row_count"], 7);
        assert_eq!(preview["missing_required"], serde_json::json!([]));
        assert_eq!(preview["fields"][0], serde_json::json!({"key": "name", "required": true}));

        let columns = preview["columns"].as_array().unwrap();
        assert_eq!(columns.len(), 3);
        assert_eq!((columns[0]["index"].as_u64(), columns[0]["header"].as_str(), columns[0]["field"].as_str()), (Some(0), Some("E-Mail"), Some("email")));
        assert_eq!(columns[1]["field"], "name");
        assert_eq!(columns[2]["field"], serde_json::Value::Null);
        assert_eq!(columns[0]["samples"].as_array().unwrap().len(), 5, "at most five samples");
        assert_eq!(columns[2]["samples"], serde_json::json!([]));
    }

    #[test]
    fn the_preview_of_an_unreadable_sheet_still_lists_what_is_there_and_what_is_missing() {
        let book = one_sheet(&[&["Anna", "a@x.de"]]);
        let preview = preview(&book, FIELDS, None).unwrap();
        assert_eq!(preview.missing_required, ["name", "email"]);
        assert!(preview.columns.iter().all(|c| c.field.is_none()));
        assert_eq!(preview.columns.len(), 2);
    }
}
