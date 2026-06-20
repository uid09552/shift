use async_trait::async_trait;
use diesel::prelude::*;
use std::sync::Arc;
use crate::repository::domain::{Shift, WeekdayTime, ShiftRepository};
use crate::models::{self, NewShift, NewShiftWeekdayTime};
use crate::schema::shifts;
use crate::schema::shift_weekday_times;
use crate::database::DbPool;
use uuid::Uuid;
use tokio::task;
use crate::errors::AppError;

#[derive(Clone)]
pub struct DieselShiftRepository {
    pub pool: Arc<DbPool>,
}

fn load_weekday_times_for_shifts(
    conn: &mut PgConnection,
    shift_ids: Vec<Uuid>,
) -> Result<std::collections::HashMap<Uuid, Vec<WeekdayTime>>, AppError> {
    let times = shift_weekday_times::table
        .filter(shift_weekday_times::shift_id.eq_any(shift_ids))
        .load::<models::ShiftWeekdayTime>(conn)
        .map_err(|_| AppError::DbError)?;

    let mut map: std::collections::HashMap<Uuid, Vec<WeekdayTime>> = std::collections::HashMap::new();
    for t in times {
        map.entry(t.shift_id)
            .or_default()
            .push(WeekdayTime {
                weekday: t.weekday,
                start_time: t.start_time,
                end_time: t.end_time,
                min_employees: t.min_employees,
                max_employees: t.max_employees,
            });
    }
    Ok(map)
}

#[async_trait]
impl ShiftRepository for DieselShiftRepository {
    async fn create_shift(&self, name: &str, short_name: &str, color: &str, order: i32) -> Result<Shift, AppError> {
        let name = name.to_string();
        let short_name = short_name.to_string();
        let color = color.to_string();
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            let new_shift = NewShift { name: &name, short_name: &short_name, color: &color, order };
            let shift = diesel::insert_into(shifts::table)
                .values(&new_shift)
                .get_result::<models::Shift>(&mut conn)
                .map_err(|e| match e {
                    diesel::result::Error::DatabaseError(diesel::result::DatabaseErrorKind::UniqueViolation, _) => {
                        AppError::Duplicate
                    }
                    diesel::result::Error::NotFound => AppError::NotFound,
                    _ => AppError::DbError,
                })?;
            Ok(Shift {
                id: shift.id,
                name: shift.name,
                short_name: shift.short_name,
                color: shift.color,
                order: shift.order,
                weekday_times: vec![],
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn get_shift(&self, id: Uuid) -> Result<Option<Shift>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let shift_opt = shifts::table
                .find(id)
                .first::<models::Shift>(&mut conn)
                .optional()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            match shift_opt {
                Some(shift) => {
                    let wt_map = load_weekday_times_for_shifts(&mut conn, vec![shift.id])
                        .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
                    Ok(Some(Shift {
                        id: shift.id,
                        name: shift.name,
                        short_name: shift.short_name,
                        color: shift.color,
                        order: shift.order,
                        weekday_times: wt_map.get(&shift.id).cloned().unwrap_or_default(),
                    }))
                }
                None => Ok(None),
            }
        })
        .await?
    }

    async fn update_shift(&self, id: Uuid, name_opt: Option<String>, short_name_opt: Option<String>, color_opt: Option<String>, order_opt: Option<i32>) -> Result<Shift, AppError> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

            // Verify shift exists and get current values
            let shift = shifts::table
                .find(id)
                .first::<models::Shift>(&mut conn)
                .map_err(|_| AppError::NotFound)?;

            // Validate hex color format if color is being updated
            if let Some(ref c) = color_opt {
                if !c.starts_with('#') || c.len() != 7 || !c[1..].chars().all(|c: char| c.is_ascii_hexdigit()) {
                    return Err(AppError::Validation("Invalid 'color' format, must be hex color e.g. #3B82F6".into()));
                }
            }

            // Determine final values
            let final_name = name_opt.unwrap_or(shift.name);
            let final_short_name = short_name_opt.unwrap_or(shift.short_name);
            let final_color = color_opt.unwrap_or(shift.color);
            let final_order = order_opt.unwrap_or(shift.order);

            let updated_shift = diesel::update(shifts::table.find(id))
                .set((
                    shifts::name.eq(&final_name),
                    shifts::short_name.eq(&final_short_name),
                    shifts::color.eq(&final_color),
                    shifts::order.eq(&final_order),
                ))
                .get_result::<models::Shift>(&mut conn)
                .map_err(|e| match e {
                    diesel::result::Error::DatabaseError(diesel::result::DatabaseErrorKind::UniqueViolation, _) => {
                        AppError::Duplicate
                    }
                    diesel::result::Error::NotFound => AppError::NotFound,
                    _ => AppError::DbError,
                })?;

            Ok(Shift {
                id: updated_shift.id,
                name: updated_shift.name,
                short_name: updated_shift.short_name,
                color: updated_shift.color,
                order: updated_shift.order,
                weekday_times: vec![],
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    async fn list_shifts(&self) -> Result<Vec<Shift>, Box<dyn std::error::Error + Send + Sync>> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
            let shifts_list = shifts::table
                .order(shifts::order.asc())
                .load::<models::Shift>(&mut conn)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            let shift_ids: Vec<Uuid> = shifts_list.iter().map(|s| s.id).collect();
            let wt_map = load_weekday_times_for_shifts(&mut conn, shift_ids)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            let result = shifts_list.into_iter().map(|s| Shift {
                id: s.id,
                name: s.name,
                short_name: s.short_name,
                color: s.color,
                order: s.order,
                weekday_times: wt_map.get(&s.id).cloned().unwrap_or_default(),
            }).collect();

            Ok(result)
        })
        .await?
    }

    async fn delete_shift(&self, id: Uuid) -> Result<(), AppError> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            // First delete all weekday times for this shift
            diesel::delete(shift_weekday_times::table.filter(shift_weekday_times::shift_id.eq(id)))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            // Then delete the shift itself
            diesel::delete(shifts::table.find(id))
                .execute(&mut conn)
                .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}

// Additional methods for managing weekday times on shifts
impl DieselShiftRepository {
    pub async fn set_weekday_time(
        &self,
        shift_id: Uuid,
        weekday: i16,
        start_time: chrono::NaiveTime,
        end_time: chrono::NaiveTime,
        min_employees: i16,
        max_employees: Option<i16>,
    ) -> Result<WeekdayTime, AppError> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;

            // Verify shift exists
            shifts::table
                .find(shift_id)
                .first::<models::Shift>(&mut conn)
                .map_err(|_| AppError::NotFound)?;

            let new_wt = NewShiftWeekdayTime {
                shift_id,
                weekday,
                start_time,
                end_time,
                min_employees,
                max_employees,
            };

            // Upsert: insert or update if the (shift_id, weekday) pair already exists
            let wt = diesel::insert_into(shift_weekday_times::table)
                .values(&new_wt)
                .on_conflict((shift_weekday_times::shift_id, shift_weekday_times::weekday))
                .do_update()
                .set((
                    shift_weekday_times::start_time.eq(start_time),
                    shift_weekday_times::end_time.eq(end_time),
                    shift_weekday_times::min_employees.eq(min_employees),
                    shift_weekday_times::max_employees.eq(max_employees),
                ))
                .get_result::<models::ShiftWeekdayTime>(&mut conn)
                .map_err(|_| AppError::DbError)?;

            Ok(WeekdayTime {
                weekday: wt.weekday,
                start_time: wt.start_time,
                end_time: wt.end_time,
                min_employees: wt.min_employees,
                max_employees: wt.max_employees,
            })
        })
        .await.map_err(|_| AppError::Internal)?
    }

    pub async fn delete_weekday_time(
        &self,
        shift_id: Uuid,
        weekday: i16,
    ) -> Result<(), AppError> {
        let pool = Arc::clone(&self.pool);
        task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| AppError::DbError)?;
            diesel::delete(
                shift_weekday_times::table
                    .filter(shift_weekday_times::shift_id.eq(shift_id))
                    .filter(shift_weekday_times::weekday.eq(weekday)),
            )
            .execute(&mut conn)
            .map_err(|_| AppError::DbError)?;
            Ok(())
        })
        .await.map_err(|_| AppError::Internal)?
    }
}
