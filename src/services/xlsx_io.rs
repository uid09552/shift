use std::io::Cursor;

use axum::body::Bytes;
use axum::extract::Multipart;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};
use rust_xlsxwriter::{Format, Workbook};

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

/// Parses the first worksheet of an `.xlsx` file into rows of trimmed cell
/// strings, skipping the header row.
pub fn parse_rows(bytes: &[u8]) -> Result<Vec<Vec<String>>, AppError> {
    let mut workbook: Xlsx<_> = open_workbook_from_rs(Cursor::new(bytes))
        .map_err(|_| AppError::Validation("Could not read uploaded file as .xlsx".into()))?;

    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| AppError::Validation("Uploaded workbook has no sheets".into()))?;

    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|_| AppError::Validation("Could not read worksheet".into()))?;

    let rows: Vec<Vec<String>> = range
        .rows()
        .skip(1) // header row
        .map(|row| {
            row.iter()
                .map(|cell| match cell {
                    Data::Empty => String::new(),
                    other => other.to_string().trim().to_string(),
                })
                .collect()
        })
        .filter(|row: &Vec<String>| row.iter().any(|cell| !cell.is_empty()))
        .collect();

    Ok(rows)
}

/// Pulls the bytes of the first file field (expected name `file`) out of a
/// multipart upload.
pub async fn extract_uploaded_file(mut multipart: Multipart) -> Result<Vec<u8>, AppError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::Validation("Invalid multipart upload".into()))?
    {
        if field.name() == Some("file") {
            let data = field
                .bytes()
                .await
                .map_err(|_| AppError::Validation("Could not read uploaded file".into()))?;
            return Ok(data.to_vec());
        }
    }
    Err(AppError::Validation("Missing 'file' field in upload".into()))
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
