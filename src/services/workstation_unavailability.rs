use axum::{
    extract::{Path, Query, State},
    Json,
};
use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::errors::AppError;
use crate::repository::AppState;
use crate::repository::domain::{WorkstationRepository, WorkstationUnavailability, WorkstationUnavailabilityRepository};
use crate::services::tenant::TenantContext;

/// When each workstation is closed: a deactivated one (`available: false`) on
/// every day, the others inside their closure periods. Loaded once per request,
/// so a whole plan can be checked without a query per row.
pub struct WorkstationClosures {
    names: HashMap<Uuid, String>,
    deactivated: HashSet<Uuid>,
    periods: HashMap<Uuid, Vec<(NaiveDate, NaiveDate)>>,
}

impl WorkstationClosures {
    pub async fn load(state: &AppState, tenant_id: &str) -> Result<Self, AppError> {
        let workstations = state
            .workstation_repo
            .list_workstations(tenant_id)
            .await
            .map_err(|_| AppError::Internal)?;
        let closures = state
            .workstation_unavailability_repo
            .list_workstation_unavailabilities(tenant_id)
            .await
            .map_err(|_| AppError::Internal)?;

        let mut periods: HashMap<Uuid, Vec<(NaiveDate, NaiveDate)>> = HashMap::new();
        for c in closures {
            periods
                .entry(c.workstation_id)
                .or_default()
                .push((c.unavailable_from, c.unavailable_to));
        }
        Ok(Self {
            deactivated: workstations.iter().filter(|w| !w.available).map(|w| w.id).collect(),
            names: workstations.into_iter().map(|w| (w.id, w.name)).collect(),
            periods,
        })
    }

    /// Why nobody can be placed at `workstation_id` on `date`, or `None` when it
    /// is open. An unknown id is not "closed" — that is a different error.
    pub fn closed_reason(&self, workstation_id: Uuid, date: NaiveDate) -> Option<String> {
        let name = self.names.get(&workstation_id)?;
        if self.deactivated.contains(&workstation_id) {
            return Some(format!("{name} is deactivated"));
        }
        self.periods
            .get(&workstation_id)?
            .iter()
            .find(|(from, to)| *from <= date && date <= *to)
            .map(|(from, to)| format!("{name} is closed from {from} to {to}"))
    }
}

#[derive(Deserialize)]
pub struct ListWorkstationUnavailabilitiesQuery {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

impl ListWorkstationUnavailabilitiesQuery {
    /// Keeps the periods that overlap the queried range. Each bound is optional
    /// on its own: `from_date` alone keeps what has not ended before it,
    /// `to_date` alone what has started by then.
    fn overlapping(
        &self,
        unavailabilities: Vec<WorkstationUnavailability>,
    ) -> Result<Vec<WorkstationUnavailability>, AppError> {
        let parse = |value: &Option<String>, name: &str| {
            value
                .as_deref()
                .map(|s| {
                    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| {
                        AppError::Validation(format!("Invalid {name} format, use YYYY-MM-DD"))
                    })
                })
                .transpose()
        };
        let from_date = parse(&self.from_date, "from_date")?;
        let to_date = parse(&self.to_date, "to_date")?;

        Ok(unavailabilities
            .into_iter()
            .filter(|u| from_date.map_or(true, |from| u.unavailable_to >= from))
            .filter(|u| to_date.map_or(true, |to| u.unavailable_from <= to))
            .collect())
    }
}

pub struct WorkstationUnavailabilityService;

impl WorkstationUnavailabilityService {
    /// Every workstation's closures at once, for views that show all stations
    /// over a date range (the workstation list, the weekly plan, the dashboard).
    pub async fn list_all_workstation_unavailabilities(
        tenant: TenantContext,
        Query(q): Query<ListWorkstationUnavailabilitiesQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let unavailabilities = state
            .workstation_unavailability_repo
            .list_workstation_unavailabilities(&tenant.0)
            .await
            .map_err(|_| AppError::Internal)?;
        let filtered = q.overlapping(unavailabilities)?;
        Ok(Json(serde_json::to_value(filtered).unwrap()))
    }

    pub async fn list_workstation_unavailabilities(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        Query(q): Query<ListWorkstationUnavailabilitiesQuery>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let unavailabilities = state
            .workstation_unavailability_repo
            .get_unavailabilities_for_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?;
        let filtered = q.overlapping(unavailabilities)?;
        Ok(Json(serde_json::to_value(filtered).unwrap()))
    }

    pub async fn create_workstation_unavailability(
        tenant: TenantContext,
        Path(workstation_id): Path<Uuid>,
        State(state): State<AppState>,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, AppError> {
        // Verify workstation exists
        state
            .workstation_repo
            .get_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        let from_str = body
            .get("unavailable_from")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'unavailable_from'".into()))?;
        let unavailable_from = NaiveDate::parse_from_str(from_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'unavailable_from' format, use YYYY-MM-DD".into()))?;

        let to_str = body
            .get("unavailable_to")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Validation("Missing 'unavailable_to'".into()))?;
        let unavailable_to = NaiveDate::parse_from_str(to_str, "%Y-%m-%d")
            .map_err(|_| AppError::Validation("Invalid 'unavailable_to' format, use YYYY-MM-DD".into()))?;

        if unavailable_to < unavailable_from {
            return Err(AppError::Validation(
                "unavailable_to must be >= unavailable_from".into(),
            ));
        }

        // One closure per day is enough: an overlap would only make removing
        // one of them leave the workstation closed anyway.
        let existing = state
            .workstation_unavailability_repo
            .get_unavailabilities_for_workstation(&tenant.0, workstation_id)
            .await
            .map_err(|_| AppError::Internal)?;
        if let Some(clash) = existing
            .iter()
            .find(|u| u.unavailable_from <= unavailable_to && u.unavailable_to >= unavailable_from)
        {
            return Err(AppError::Validation(format!(
                "The workstation is already closed from {} to {}",
                clash.unavailable_from, clash.unavailable_to
            )));
        }

        let unavailability = WorkstationUnavailability {
            id: Uuid::new_v4(), // Will be replaced by DB-generated ID
            workstation_id,
            unavailable_from,
            unavailable_to,
        };

        let created = state
            .workstation_unavailability_repo
            .create_workstation_unavailability(&tenant.0, unavailability)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::to_value(created).unwrap()))
    }

    pub async fn get_workstation_unavailability_by_id(
        tenant: TenantContext,
        Path((_workstation_id, unavailability_id)): Path<(Uuid, Uuid)>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        let unavailability = state
            .workstation_unavailability_repo
            .get_workstation_unavailability(&tenant.0, unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;
        Ok(Json(serde_json::to_value(unavailability).unwrap()))
    }

    pub async fn delete_workstation_unavailability(
        tenant: TenantContext,
        Path((_workstation_id, unavailability_id)): Path<(Uuid, Uuid)>,
        State(state): State<AppState>,
    ) -> Result<Json<Value>, AppError> {
        state
            .workstation_unavailability_repo
            .get_workstation_unavailability(&tenant.0, unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?
            .ok_or(AppError::NotFound)?;

        state
            .workstation_unavailability_repo
            .delete_workstation_unavailability(&tenant.0, unavailability_id)
            .await
            .map_err(|_| AppError::Internal)?;

        Ok(Json(serde_json::json!({ "message": "Workstation unavailability deleted successfully" })))
    }
}
