use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::{
    EmployeeRepository, EmployeeShiftAssignment, EmployeeShiftAssignmentRepository, ShiftRepository,
};
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::TenantContext;

#[derive(Deserialize)]
pub struct ListShiftAssignmentsQuery {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

/// One row of a bulk import: who works which shift on which day, named the way
/// the source document named them rather than by id — the caller (the chat
/// agent reading an uploaded roster, chiefly) has names, not UUIDs.
#[derive(Deserialize)]
pub struct ImportAssignmentRow {
    /// Employee UUID, email or full name, as written in the source document.
    pub employee: String,
    /// Shift UUID, name or short name (the roster code), as written.
    pub shift: String,
    /// ISO date, `YYYY-MM-DD`.
    pub date: String,
}

#[derive(Deserialize)]
pub struct ImportAssignmentsRequest {
    pub assignments: Vec<ImportAssignmentRow>,
    /// Resolve and validate everything, report what *would* happen, write
    /// nothing. This is what makes the agent's "here is what I read, shall I
    /// take it?" step possible.
    #[serde(default)]
    pub dry_run: bool,
    /// Replace an employee's existing assignment on a date instead of
    /// reporting it as a conflict (one assignment per employee per date).
    #[serde(default)]
    pub replace_existing: bool,
}

#[derive(Serialize)]
pub struct ImportAssignmentIssue {
    pub row: usize,
    pub employee: String,
    pub shift: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize, Default)]
pub struct ImportAssignmentsResult {
    pub dry_run: bool,
    pub total: usize,
    /// Rows that resolved to a real employee, shift and date.
    pub resolved: usize,
    /// Rows actually written (always 0 for a dry run).
    pub created: usize,
    /// Rows that replaced an existing assignment on the same date.
    pub replaced: usize,
    pub skipped: usize,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    /// Distinct employee names in the file that matched nothing.
    pub unmatched_employees: Vec<String>,
    /// Distinct shift names/codes in the file that matched nothing.
    pub unmatched_shifts: Vec<String>,
    /// Distinct name -> matched employee, so the caller can show what it read
    /// as what before anything is written.
    pub matched_employees: Vec<MatchedName>,
    pub matched_shifts: Vec<MatchedName>,
    pub errors: Vec<ImportAssignmentIssue>,
}

#[derive(Serialize)]
pub struct MatchedName {
    /// The spelling used in the source document.
    pub input: String,
    /// The record it was matched to.
    pub matched: String,
    pub id: Uuid,
}

/// Lowercased, whitespace-collapsed form used for all name matching.
fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// "Meier, Anna" -> "anna meier", so rosters written surname-first still match.
fn swap_comma_name(value: &str) -> Option<String> {
    let (last, first) = value.split_once(',')?;
    let (last, first) = (last.trim(), first.trim());
    if last.is_empty() || first.is_empty() {
        return None;
    }
    Some(normalize(&format!("{first} {last}")))
}

/// Dates as they turn up in rosters: ISO first, then the common European and
/// US separators. Nothing ambiguous is guessed — `01/02` stays day/month only
/// where the ISO form already failed, and the caller is expected to send ISO.
fn parse_date(value: &str) -> Option<NaiveDate> {
    let value = value.trim();
    for fmt in ["%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"] {
        if let Ok(d) = NaiveDate::parse_from_str(value, fmt) {
            return Some(d);
        }
    }
    None
}

pub struct ShiftAssignmentService;

impl ShiftAssignmentService {
    /// GET /employees/:employee_id/shift-assignments
    /// Returns the fixed shift plan for a specific employee.
    /// Supports optional from_date/to_date query parameters for date range filtering.
    pub async fn get_employee_shift_assignments(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        Query(q): Query<ListShiftAssignmentsQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let assignments = if let (Some(from_str), Some(to_str)) = (q.from_date, q.to_date) {
            let from_date = NaiveDate::parse_from_str(&from_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid from_date format, use YYYY-MM-DD".into()))?;
            let to_date = NaiveDate::parse_from_str(&to_str, "%Y-%m-%d")
                .map_err(|_| AppError::Validation("Invalid to_date format, use YYYY-MM-DD".into()))?;
            state
                .shift_assignment_repo
                .get_assignments_for_employee_in_range(&tenant.0, employee_id, from_date, to_date)
                .await
                .map_err(|_| AppError::Internal)?
        } else {
            state
                .shift_assignment_repo
                .get_assignments_for_employee(&tenant.0, employee_id)
                .await
                .map_err(|_| AppError::Internal)?
        };

        Ok(Json(serde_json::to_value(assignments).unwrap()))
    }

    /// POST /employees/:employee_id/shift-assignments
    /// Creates a new fixed shift assignment for an employee.
    pub async fn create_shift_assignment(
        tenant: TenantContext,
        Path(employee_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        // A shift id, or an explicit null for a fixed day off.
        let shift_id = match body.get("shift_id") {
            None => return Err(AppError::Validation("Missing 'shift_id' (null for a day off)".into())),
            Some(v) if v.is_null() => None,
            Some(v) => Some(
                v.as_str()
                    .ok_or_else(|| AppError::Validation("Invalid 'shift_id', expected UUID string or null".into()))?
                    .parse::<Uuid>()
                    .map_err(|_| AppError::Validation("Invalid 'shift_id' UUID".into()))?,
            ),
        };

        let date_str = body
            .get("date")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'date'".into()))?;

        let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'date' format, use YYYY-MM-DD".into()))?;

        let assignment = EmployeeShiftAssignment {
            id: Uuid::new_v4(), // Will be replaced by DB-generated ID
            employee_id,
            shift_id,
            date,
        };

        let created = state
            .shift_assignment_repo
            .create_assignment(&tenant.0, assignment)
            .await?;

        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    /// POST /shift-assignments/import
    /// Creates many fixed shift assignments in one call, matching employees and
    /// shifts by name rather than id.
    ///
    /// Built for the chat agent's roster upload: it reads a PDF/CSV/XLSX plan,
    /// works out which column is what, and sends the rows here. With
    /// `dry_run` it gets back exactly what would be written — including which
    /// names it failed to match — so it can show the interpretation and ask
    /// before anything lands in the database.
    pub async fn import_shift_assignments(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<ImportAssignmentsRequest>,
    ) -> Result<Json<Value>, AppError> {
        // Employees and shifts are read once and matched in memory: a roster
        // is hundreds of rows over a handful of distinct names.
        let employees = state.employee_repo.list_employees(&tenant.0, None, None).await?;
        let shifts = state.shift_repo.list_shifts(&tenant.0).await?;

        let mut employee_index: HashMap<String, (Uuid, String)> = HashMap::new();
        for e in &employees {
            employee_index.insert(normalize(&e.name), (e.id, e.name.clone()));
            employee_index.insert(normalize(&e.email), (e.id, e.name.clone()));
            employee_index.insert(e.id.to_string(), (e.id, e.name.clone()));
        }

        let mut shift_index: HashMap<String, (Uuid, String)> = HashMap::new();
        for s in &shifts {
            shift_index.insert(normalize(&s.name), (s.id, s.name.clone()));
            shift_index.insert(normalize(&s.short_name), (s.id, s.name.clone()));
            shift_index.insert(s.id.to_string(), (s.id, s.name.clone()));
        }

        let mut result = ImportAssignmentsResult {
            dry_run: body.dry_run,
            total: body.assignments.len(),
            ..Default::default()
        };
        let mut seen_employees: HashMap<String, Option<Uuid>> = HashMap::new();
        let mut seen_shifts: HashMap<String, Option<Uuid>> = HashMap::new();
        // (employee, date) pairs already accepted in this request — a roster
        // that lists someone twice on one day would otherwise hit the unique
        // constraint halfway through.
        let mut claimed: HashMap<(Uuid, NaiveDate), usize> = HashMap::new();
        // Span of the rows that resolved, reported back so the caller can show
        // the user which month it actually read.
        let mut span_from: Option<NaiveDate> = None;
        let mut span_to: Option<NaiveDate> = None;

        for (idx, row) in body.assignments.iter().enumerate() {
            let row_num = idx + 1;
            let issue = |message: String| ImportAssignmentIssue {
                row: row_num,
                employee: row.employee.clone(),
                shift: row.shift.clone(),
                date: row.date.clone(),
                message,
            };

            let employee_key = normalize(&row.employee);
            let employee_match = employee_index
                .get(&employee_key)
                .or_else(|| swap_comma_name(&row.employee).and_then(|k| employee_index.get(&k)))
                .cloned();
            if let Some((id, name)) = &employee_match {
                if seen_employees.insert(row.employee.clone(), Some(*id)).is_none() {
                    result.matched_employees.push(MatchedName {
                        input: row.employee.clone(),
                        matched: name.clone(),
                        id: *id,
                    });
                }
            } else if seen_employees.insert(row.employee.clone(), None).is_none() {
                result.unmatched_employees.push(row.employee.clone());
            }

            let shift_match = shift_index.get(&normalize(&row.shift)).cloned();
            if let Some((id, name)) = &shift_match {
                if seen_shifts.insert(row.shift.clone(), Some(*id)).is_none() {
                    result.matched_shifts.push(MatchedName {
                        input: row.shift.clone(),
                        matched: name.clone(),
                        id: *id,
                    });
                }
            } else if seen_shifts.insert(row.shift.clone(), None).is_none() {
                result.unmatched_shifts.push(row.shift.clone());
            }

            let (employee_id, shift_id) = match (&employee_match, &shift_match) {
                (Some((e, _)), Some((s, _))) => (*e, *s),
                (None, Some(_)) => {
                    result.skipped += 1;
                    result.errors.push(issue(format!("No employee matches '{}'", row.employee)));
                    continue;
                }
                (Some(_), None) => {
                    result.skipped += 1;
                    result.errors.push(issue(format!("No shift matches '{}'", row.shift)));
                    continue;
                }
                (None, None) => {
                    result.skipped += 1;
                    result.errors.push(issue(format!(
                        "No employee matches '{}' and no shift matches '{}'",
                        row.employee, row.shift
                    )));
                    continue;
                }
            };

            let Some(date) = parse_date(&row.date) else {
                result.skipped += 1;
                result.errors.push(issue(format!("Unreadable date '{}', use YYYY-MM-DD", row.date)));
                continue;
            };

            if let Some(first_row) = claimed.get(&(employee_id, date)) {
                result.skipped += 1;
                result.errors.push(issue(format!(
                    "Duplicate — the same employee is already assigned on {date} by row {first_row}"
                )));
                continue;
            }
            claimed.insert((employee_id, date), row_num);

            result.resolved += 1;
            span_from = Some(span_from.map_or(date, |d: NaiveDate| d.min(date)));
            span_to = Some(span_to.map_or(date, |d: NaiveDate| d.max(date)));

            if body.dry_run {
                continue;
            }

            let new_assignment = || EmployeeShiftAssignment {
                id: Uuid::new_v4(), // replaced by the DB-generated id
                employee_id,
                shift_id: Some(shift_id),
                date,
            };

            // Insert first and let the unique constraint find the collision,
            // rather than clearing the day up front: an existing assignment is
            // only ever deleted once we know one is actually in the way.
            let mut outcome = state
                .shift_assignment_repo
                .create_assignment(&tenant.0, new_assignment())
                .await;

            if matches!(outcome, Err(AppError::Duplicate)) && body.replace_existing {
                let existing = state
                    .shift_assignment_repo
                    .get_assignments_for_employee_in_range(&tenant.0, employee_id, date, date)
                    .await
                    .unwrap_or_default();
                for a in existing {
                    let _ = state
                        .shift_assignment_repo
                        .delete_assignment(&tenant.0, a.id)
                        .await;
                }
                outcome = state
                    .shift_assignment_repo
                    .create_assignment(&tenant.0, new_assignment())
                    .await;
                if outcome.is_ok() {
                    result.replaced += 1;
                }
            }

            match outcome {
                Ok(_) => result.created += 1,
                Err(AppError::Duplicate) => {
                    result.skipped += 1;
                    result.errors.push(issue(format!(
                        "Already assigned on {date} — pass replace_existing to overwrite"
                    )));
                }
                Err(_) => {
                    result.skipped += 1;
                    result.errors.push(issue("Failed to create assignment".into()));
                }
            }
        }

        result.from_date = span_from.map(|d| d.to_string());
        result.to_date = span_to.map(|d| d.to_string());

        if !body.dry_run {
            audit_log::record(
                &state,
                &tenant.0,
                actor.0,
                "shift_assignment.import",
                "shift_assignment",
                None,
                Some(
                    serde_json::json!({
                        "created": result.created,
                        "replaced": result.replaced,
                        "skipped": result.skipped,
                        "from_date": result.from_date,
                        "to_date": result.to_date,
                    })
                    .to_string(),
                ),
            )
            .await;
        }

        Ok(Json(serde_json::to_value(result).unwrap()))
    }

    /// DELETE /shift-assignments/:assignment_id
    /// Deletes a specific shift assignment.
    pub async fn delete_shift_assignment(
        tenant: TenantContext,
        Path(assignment_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .shift_assignment_repo
            .delete_assignment(&tenant.0, assignment_id)
            .await?;

        Ok(Json(serde_json::json!({ "deleted": true })))
    }
}
