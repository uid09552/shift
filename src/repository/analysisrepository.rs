use async_trait::async_trait;
use chrono::Datelike;
use chrono::NaiveDate;
use diesel::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::task;
use uuid::Uuid;

use crate::database::DbPool;
use crate::errors::AppError;
use crate::models as models;
use crate::schema::confirmed_shift_plans;
use crate::schema::shift_weekday_times;
use crate::schema::workstations;

use super::domain::{AnalysisRepository, WorkstationDailyEmployeesDomain, WorkstationDailyHoursDomain};

#[derive(Clone)]
pub struct DieselAnalysisRepository {
    pub pool: Arc<DbPool>,
}

#[async_trait]
impl AnalysisRepository for DieselAnalysisRepository {
    async fn get_planned_hours_per_day_per_workstation(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<WorkstationDailyHoursDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;

            // Fetch confirmed shift plans in range where employee is present and workstation is assigned
            let plans: Vec<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                .filter(confirmed_shift_plans::is_present.eq(true))
                .filter(confirmed_shift_plans::workstation_id.is_not_null())
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            if plans.is_empty() {
                return Ok(Vec::new());
            }

            // Collect unique shift IDs and workstation IDs
            let shift_ids: Vec<Uuid> = plans.iter().filter_map(|p| p.shift_id).collect::<std::collections::HashSet<_>>().into_iter().collect();
            let workstation_ids: Vec<Uuid> = plans.iter().filter_map(|p| p.workstation_id).collect::<std::collections::HashSet<_>>().into_iter().collect();

            // Fetch shift weekday times for the relevant shifts
            let weekday_times: Vec<models::ShiftWeekdayTime> = shift_weekday_times::table
                .filter(shift_weekday_times::shift_id.eq_any(&shift_ids))
                .filter(shift_weekday_times::tenant_id.eq(&tenant_id))
                .load::<models::ShiftWeekdayTime>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            // Build a map: (shift_id, weekday) -> duration in hours
            // Handle overnight shifts: if end_time < start_time, the shift crosses midnight
            let mut shift_weekday_hours: HashMap<(Uuid, i16), f64> = HashMap::new();
            for swt in &weekday_times {
                let duration_secs = if swt.end_time >= swt.start_time {
                    (swt.end_time - swt.start_time).num_seconds() as f64
                } else {
                    // Overnight shift: e.g. 22:00 - 06:00 = 8 hours
                    ((chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap() - swt.start_time).num_seconds()
                        + (swt.end_time - chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()).num_seconds()
                        + 1) as f64 // +1 second for 23:59:59 -> 00:00:00 boundary
                };
                let duration_hours = duration_secs / 3600.0;
                shift_weekday_hours.insert((swt.shift_id, swt.weekday), duration_hours);
            }

            // Fetch workstation names
            let ws_list: Vec<models::Workstation> = workstations::table
                .filter(workstations::id.eq_any(&workstation_ids))
                .filter(workstations::tenant_id.eq(&tenant_id))
                .load::<models::Workstation>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            let ws_names: HashMap<Uuid, String> = ws_list.into_iter().map(|w| (w.id, w.name)).collect();

            // Aggregate: (date, workstation_id) -> total planned hours
            let mut result_map: HashMap<(NaiveDate, Uuid), f64> = HashMap::new();
            for plan in &plans {
                if let Some(ws_id) = plan.workstation_id {
                    // ISODOW: Monday=1..Sunday=7
                    let weekday_isodow = (plan.date.weekday().num_days_from_monday() + 1) as i16;
                    let hours = plan.shift_id
                        .and_then(|sid| shift_weekday_hours.get(&(sid, weekday_isodow)).copied())
                        .unwrap_or(0.0);
                    *result_map.entry((plan.date, ws_id)).or_insert(0.0) += hours;
                }
            }

            // Convert to sorted vec
            let mut results: Vec<WorkstationDailyHoursDomain> = result_map
                .into_iter()
                .map(|((date, ws_id), planned_hours)| WorkstationDailyHoursDomain {
                    date,
                    workstation_id: ws_id,
                    workstation_name: ws_names.get(&ws_id).cloned().unwrap_or_default(),
                    planned_hours,
                })
                .collect();

            results.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.workstation_name.cmp(&b.workstation_name)));

            Ok(results)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }

    async fn get_planned_employees_per_day_per_workstation(
        &self,
        tenant_id: &str,
        from_date: NaiveDate,
        to_date: NaiveDate,
    ) -> Result<Vec<WorkstationDailyEmployeesDomain>, AppError> {
        let tenant_id = tenant_id.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::Internal)?;

            // Fetch confirmed shift plans in range where employee is present and workstation is assigned
            let plans: Vec<models::ConfirmedShiftPlan> = confirmed_shift_plans::table
                .filter(confirmed_shift_plans::tenant_id.eq(&tenant_id))
                .filter(confirmed_shift_plans::is_present.eq(true))
                .filter(confirmed_shift_plans::workstation_id.is_not_null())
                .filter(confirmed_shift_plans::date.ge(from_date))
                .filter(confirmed_shift_plans::date.le(to_date))
                .load::<models::ConfirmedShiftPlan>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            if plans.is_empty() {
                return Ok(Vec::new());
            }

            // Collect unique workstation IDs
            let workstation_ids: Vec<Uuid> = plans.iter().filter_map(|p| p.workstation_id).collect::<std::collections::HashSet<_>>().into_iter().collect();

            // Fetch workstation names
            let ws_list: Vec<models::Workstation> = workstations::table
                .filter(workstations::id.eq_any(&workstation_ids))
                .filter(workstations::tenant_id.eq(&tenant_id))
                .load::<models::Workstation>(&mut conn)
                .map_err(|_| AppError::Internal)?;

            let ws_names: HashMap<Uuid, String> = ws_list.into_iter().map(|w| (w.id, w.name)).collect();

            // Aggregate: (date, workstation_id) -> count of employees
            let mut result_map: HashMap<(NaiveDate, Uuid), i64> = HashMap::new();
            for plan in &plans {
                if let Some(ws_id) = plan.workstation_id {
                    *result_map.entry((plan.date, ws_id)).or_insert(0) += 1;
                }
            }

            // Convert to sorted vec
            let mut results: Vec<WorkstationDailyEmployeesDomain> = result_map
                .into_iter()
                .map(|((date, ws_id), planned_employees)| WorkstationDailyEmployeesDomain {
                    date,
                    workstation_id: ws_id,
                    workstation_name: ws_names.get(&ws_id).cloned().unwrap_or_default(),
                    planned_employees,
                })
                .collect();

            results.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.workstation_name.cmp(&b.workstation_name)));

            Ok(results)
        })
        .await
        .map_err(|_| AppError::Internal)?
    }
}
