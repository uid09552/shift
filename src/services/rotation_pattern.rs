//! Rotation patterns: a named rhythm ("early, early, late, late, night, night,
//! off, off") applied to people over a period.
//!
//! A pattern is only a recipe. Applying it writes ordinary fixed assignments
//! (`employee_shift_assignments`) — a shift for a working slot, no shift for a
//! day off — which the planner then keeps ahead of every other goal. The same
//! call with `dry_run` returns the grid it would write, which is the preview.

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::domain::{
    EmployeeRepository, EmployeeShiftAssignment, EmployeeShiftAssignmentRepository,
    RotationPatternRepository, ShiftRepository, UnavailabilityRepository,
};
use crate::repository::AppState;
use crate::services::audit_log::{self, AuditActor};
use crate::services::tenant::TenantContext;

/// A cycle longer than eight weeks is not a rhythm anybody works to.
const MAX_SLOTS: usize = 56;
/// Applying beyond a year ahead is a planning horizon, not a rotation.
const MAX_DAYS: i64 = 366;

#[derive(Deserialize)]
pub struct PatternRequest {
    pub name: String,
    /// One entry per day of the cycle: a shift id, or null for a day off.
    pub slots: Vec<Option<Uuid>>,
}

#[derive(Deserialize)]
pub struct ApplyPatternRequest {
    pub employee_ids: Vec<Uuid>,
    pub start_date: String,
    pub end_date: String,
    /// How many days later in the cycle each next person starts, so a team
    /// can be staggered across the rhythm. 0 = everyone in step.
    #[serde(default)]
    pub offset_step: i64,
    /// Overwrite fixed assignments already in the period instead of leaving
    /// them and reporting a conflict.
    #[serde(default)]
    pub replace_existing: bool,
    /// Work everything out and return the grid, write nothing.
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Deserialize)]
pub struct RangeQuery {
    pub from_date: String,
    pub to_date: String,
    /// Comma-separated employee ids; everyone when absent.
    pub employee_ids: Option<String>,
}

#[derive(Deserialize)]
pub struct ClearRequest {
    pub employee_ids: Vec<Uuid>,
    pub from_date: String,
    pub to_date: String,
}

/// What applying does to one day of one person.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CellStatus {
    /// Nothing fixed yet; will be written.
    New,
    /// Already fixed exactly like this; left alone.
    Same,
    /// Fixed differently; will be overwritten (replace_existing).
    Replace,
    /// Fixed differently; left alone and reported.
    Conflict,
    /// A working slot on a day the person is absent; not written — the
    /// planner could never keep it.
    Absent,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ExistingCell {
    pub shift_id: Option<Uuid>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct PlannedCell {
    pub date: NaiveDate,
    /// What the pattern puts here: a shift, or None for a day off.
    pub shift_id: Option<Uuid>,
    pub status: CellStatus,
    /// The fixed assignment already on this day, if any.
    pub existing: Option<ExistingCell>,
}

#[derive(Serialize, Debug, Clone)]
pub struct PlannedRow {
    pub employee_id: Uuid,
    pub employee_name: String,
    /// Where in the cycle this person starts.
    pub offset: i64,
    pub cells: Vec<PlannedCell>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct ApplySummary {
    pub written: usize,
    pub replaced: usize,
    pub unchanged: usize,
    pub conflicts: usize,
    pub on_absence: usize,
}

/// The grid a pattern produces for these people, against what is already
/// fixed and who is away. Pure, so it is the same for the preview and the write.
fn plan_rotation(
    slots: &[Option<Uuid>],
    people: &[(Uuid, String)],
    start: NaiveDate,
    end: NaiveDate,
    offset_step: i64,
    replace_existing: bool,
    existing: &HashMap<(Uuid, NaiveDate), Option<Uuid>>,
    absent: &HashSet<(Uuid, NaiveDate)>,
) -> (Vec<PlannedRow>, ApplySummary) {
    let len = slots.len() as i64;
    let mut summary = ApplySummary::default();
    let rows = people
        .iter()
        .enumerate()
        .map(|(i, (employee_id, name))| {
            let offset = (i as i64 * offset_step).rem_euclid(len);
            let cells = (0..=(end - start).num_days())
                .map(|day| {
                    let date = start + chrono::Duration::days(day);
                    let shift_id = slots[((day + offset).rem_euclid(len)) as usize];
                    let before = existing.get(&(*employee_id, date)).copied();
                    let status = if shift_id.is_some() && absent.contains(&(*employee_id, date)) {
                        CellStatus::Absent
                    } else {
                        match before {
                            None => CellStatus::New,
                            Some(b) if b == shift_id => CellStatus::Same,
                            Some(_) if replace_existing => CellStatus::Replace,
                            Some(_) => CellStatus::Conflict,
                        }
                    };
                    match status {
                        CellStatus::New => summary.written += 1,
                        CellStatus::Replace => {
                            summary.written += 1;
                            summary.replaced += 1;
                        }
                        CellStatus::Same => summary.unchanged += 1,
                        CellStatus::Conflict => summary.conflicts += 1,
                        CellStatus::Absent => summary.on_absence += 1,
                    }
                    PlannedCell {
                        date,
                        shift_id,
                        status,
                        existing: before.map(|shift_id| ExistingCell { shift_id }),
                    }
                })
                .collect();
            PlannedRow { employee_id: *employee_id, employee_name: name.clone(), offset, cells }
        })
        .collect();
    (rows, summary)
}

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::Validation(format!("Invalid {field} format, use YYYY-MM-DD")))
}

fn parse_range(from: &str, to: &str) -> Result<(NaiveDate, NaiveDate), AppError> {
    let from = parse_date(from, "from_date")?;
    let to = parse_date(to, "to_date")?;
    if to < from {
        return Err(AppError::Validation("The end date is before the start date".into()));
    }
    if (to - from).num_days() >= MAX_DAYS {
        return Err(AppError::Validation("The period may cover at most one year".into()));
    }
    Ok((from, to))
}

pub struct RotationPatternService;

impl RotationPatternService {
    /// Rejects an empty or overlong cycle, one without any working day, and
    /// shift ids that are not this organisation's.
    async fn validate(state: &AppState, tenant_id: &str, body: &PatternRequest) -> Result<String, AppError> {
        let name = body.name.trim().to_string();
        if name.is_empty() {
            return Err(AppError::Validation("A pattern needs a name".into()));
        }
        if body.slots.is_empty() || body.slots.len() > MAX_SLOTS {
            return Err(AppError::Validation(format!("A cycle has between 1 and {MAX_SLOTS} days")));
        }
        if body.slots.iter().all(Option::is_none) {
            return Err(AppError::Validation("A pattern needs at least one working day".into()));
        }
        let known: HashSet<Uuid> = state.shift_repo.list_shifts(tenant_id).await?.into_iter().map(|s| s.id).collect();
        if let Some(unknown) = body.slots.iter().flatten().find(|id| !known.contains(id)) {
            return Err(AppError::Validation(format!("Unknown shift {unknown}")));
        }
        Ok(name)
    }

    /// GET /rotation-patterns
    pub async fn list_patterns(tenant: TenantContext, State(state): State<AppState>) -> Result<Json<Value>, AppError> {
        let patterns = state.rotation_pattern_repo.list_patterns(&tenant.0).await?;
        Ok(Json(serde_json::to_value(patterns).unwrap()))
    }

    /// POST /rotation-patterns
    pub async fn create_pattern(
        tenant: TenantContext,
        State(state): State<AppState>,
        Json(body): Json<PatternRequest>,
    ) -> Result<Json<Value>, AppError> {
        let name = Self::validate(&state, &tenant.0, &body).await?;
        let created = state
            .rotation_pattern_repo
            .create_pattern(&tenant.0, name, body.slots)
            .await
            .map_err(|e| match e {
                AppError::Duplicate => AppError::Validation("A pattern with this name already exists".into()),
                other => other,
            })?;
        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    /// PUT /rotation-patterns/:pattern_id
    pub async fn update_pattern(
        tenant: TenantContext,
        Path(pattern_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<PatternRequest>,
    ) -> Result<Json<Value>, AppError> {
        let name = Self::validate(&state, &tenant.0, &body).await?;
        let updated = state
            .rotation_pattern_repo
            .update_pattern(&tenant.0, pattern_id, name, body.slots)
            .await
            .map_err(|e| match e {
                AppError::Duplicate => AppError::Validation("A pattern with this name already exists".into()),
                other => other,
            })?;
        Ok(Json(serde_json::to_value(updated).unwrap()))
    }

    /// DELETE /rotation-patterns/:pattern_id — the pattern only; assignments
    /// already written from it stay.
    pub async fn delete_pattern(
        tenant: TenantContext,
        Path(pattern_id): Path<Uuid>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state.rotation_pattern_repo.delete_pattern(&tenant.0, pattern_id).await?;
        Ok(Json(serde_json::json!({ "deleted": true })))
    }

    /// POST /rotation-patterns/:pattern_id/apply
    pub async fn apply_pattern(
        tenant: TenantContext,
        actor: AuditActor,
        Path(pattern_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<ApplyPatternRequest>,
    ) -> Result<Json<Value>, AppError> {
        let pattern = state
            .rotation_pattern_repo
            .get_pattern(&tenant.0, pattern_id)
            .await?
            .ok_or(AppError::NotFound)?;
        if pattern.slots.is_empty() {
            return Err(AppError::Validation("The pattern has no days".into()));
        }
        if body.employee_ids.is_empty() {
            return Err(AppError::Validation("Pick at least one person".into()));
        }
        let (start, end) = parse_range(&body.start_date, &body.end_date)?;

        // In the order asked for: that order is what the stagger follows.
        let found: HashMap<Uuid, String> = state
            .employee_repo
            .list_employees_by_ids(&tenant.0, &body.employee_ids)
            .await?
            .into_iter()
            .map(|e| (e.id, e.name))
            .collect();
        let mut people = Vec::new();
        for id in &body.employee_ids {
            let name = found.get(id).ok_or_else(|| AppError::Validation(format!("Unknown employee {id}")))?;
            if !people.iter().any(|(p, _): &(Uuid, String)| p == id) {
                people.push((*id, name.clone()));
            }
        }

        let current = state
            .shift_assignment_repo
            .list_assignments_in_range(&tenant.0, Some(body.employee_ids.clone()), start, end)
            .await?;
        let existing: HashMap<(Uuid, NaiveDate), Option<Uuid>> =
            current.iter().map(|a| ((a.employee_id, a.date), a.shift_id)).collect();
        let ids: HashSet<Uuid> = body.employee_ids.iter().copied().collect();
        let absent: HashSet<(Uuid, NaiveDate)> = state
            .unavailability_repo
            .list_unavailabilities(&tenant.0)
            .await?
            .into_iter()
            .filter(|u| !u.is_soft_preference && ids.contains(&u.employee_id))
            .filter(|u| start <= u.unavailable_date && u.unavailable_date <= end)
            .map(|u| (u.employee_id, u.unavailable_date))
            .collect();

        let (rows, summary) = plan_rotation(
            &pattern.slots, &people, start, end, body.offset_step, body.replace_existing, &existing, &absent,
        );

        if !body.dry_run && summary.written > 0 {
            let by_day: HashMap<(Uuid, NaiveDate), Uuid> =
                current.iter().map(|a| ((a.employee_id, a.date), a.id)).collect();
            let mut deletes = Vec::new();
            let mut inserts = Vec::new();
            for row in &rows {
                for cell in &row.cells {
                    if !matches!(cell.status, CellStatus::New | CellStatus::Replace) {
                        continue;
                    }
                    if cell.status == CellStatus::Replace {
                        deletes.extend(by_day.get(&(row.employee_id, cell.date)).copied());
                    }
                    inserts.push(EmployeeShiftAssignment {
                        id: Uuid::new_v4(),
                        employee_id: row.employee_id,
                        shift_id: cell.shift_id,
                        date: cell.date,
                    });
                }
            }
            state.shift_assignment_repo.replace_assignments(&tenant.0, deletes, inserts).await?;
            audit_log::record(
                &state,
                &tenant.0,
                actor.0,
                "rotation_pattern.apply",
                "rotation_pattern",
                Some(pattern.id.to_string()),
                Some(
                    serde_json::json!({
                        "pattern": pattern.name,
                        "employees": people.len(),
                        "from_date": start,
                        "to_date": end,
                        "written": summary.written,
                        "replaced": summary.replaced,
                    })
                    .to_string(),
                ),
            )
            .await;
        }

        Ok(Json(serde_json::json!({
            "dry_run": body.dry_run,
            "pattern_id": pattern.id,
            "cycle_length": pattern.slots.len(),
            "from_date": start,
            "to_date": end,
            "summary": summary,
            "rows": rows,
        })))
    }

    /// GET /shift-assignments — fixed assignments in a range, for everyone or
    /// the listed employees.
    pub async fn list_assignments(
        tenant: TenantContext,
        Query(q): Query<RangeQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let (from, to) = parse_range(&q.from_date, &q.to_date)?;
        let ids = q
            .employee_ids
            .map(|raw| {
                raw.split(',')
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.trim().parse::<Uuid>().map_err(|_| AppError::Validation(format!("Invalid employee id {s}"))))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;
        let assignments = state.shift_assignment_repo.list_assignments_in_range(&tenant.0, ids, from, to).await?;
        Ok(Json(serde_json::to_value(assignments).unwrap()))
    }

    /// POST /shift-assignments/clear — removes these people's fixed
    /// assignments in the range, so the planner decides those days again.
    pub async fn clear_assignments(
        tenant: TenantContext,
        actor: AuditActor,
        State(state): State<AppState>,
        Json(body): Json<ClearRequest>,
    ) -> Result<Json<Value>, AppError> {
        if body.employee_ids.is_empty() {
            return Err(AppError::Validation("Pick at least one person".into()));
        }
        let (from, to) = parse_range(&body.from_date, &body.to_date)?;
        let deleted = state
            .shift_assignment_repo
            .delete_assignments_in_range(&tenant.0, body.employee_ids.clone(), from, to)
            .await?;
        audit_log::record(
            &state,
            &tenant.0,
            actor.0,
            "shift_assignment.clear",
            "shift_assignment",
            None,
            Some(
                serde_json::json!({ "employees": body.employee_ids.len(), "from_date": from, "to_date": to, "deleted": deleted })
                    .to_string(),
            ),
        )
        .await;
        Ok(Json(serde_json::json!({ "deleted": deleted })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn repeats_the_cycle_and_staggers_each_next_person() {
        let (early, night) = (Uuid::new_v4(), Uuid::new_v4());
        let slots = [Some(early), Some(night), None];
        let people = [(Uuid::new_v4(), "Anna".to_string()), (Uuid::new_v4(), "Ben".to_string())];

        let (rows, summary) = plan_rotation(&slots, &people, d("2026-10-05"), d("2026-10-09"), 1, false, &HashMap::new(), &HashSet::new());

        let shifts = |r: &PlannedRow| r.cells.iter().map(|c| c.shift_id).collect::<Vec<_>>();
        assert_eq!(shifts(&rows[0]), vec![Some(early), Some(night), None, Some(early), Some(night)]);
        // One day further into the cycle.
        assert_eq!(rows[1].offset, 1);
        assert_eq!(shifts(&rows[1]), vec![Some(night), None, Some(early), Some(night), None]);
        assert_eq!(summary.written, 10, "days off are written too — the rhythm needs them");
    }

    #[test]
    fn keeps_what_is_there_unless_told_to_replace_and_skips_absences() {
        let early = Uuid::new_v4();
        let late = Uuid::new_v4();
        let anna = Uuid::new_v4();
        let people = [(anna, "Anna".to_string())];
        let existing = HashMap::from([
            ((anna, d("2026-10-05")), Some(early)), // same as the pattern
            ((anna, d("2026-10-06")), Some(late)),  // different
        ]);
        let absent = HashSet::from([(anna, d("2026-10-07"))]);

        let (rows, summary) = plan_rotation(&[Some(early)], &people, d("2026-10-05"), d("2026-10-08"), 0, false, &existing, &absent);
        let statuses: Vec<_> = rows[0].cells.iter().map(|c| c.status).collect();
        assert_eq!(statuses, vec![CellStatus::Same, CellStatus::Conflict, CellStatus::Absent, CellStatus::New]);
        assert_eq!(summary, ApplySummary { written: 1, replaced: 0, unchanged: 1, conflicts: 1, on_absence: 1 });

        let (_, summary) = plan_rotation(&[Some(early)], &people, d("2026-10-05"), d("2026-10-08"), 0, true, &existing, &absent);
        assert_eq!((summary.written, summary.replaced, summary.conflicts), (2, 1, 0));
    }
}
