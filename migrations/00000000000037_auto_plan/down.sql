ALTER TABLE planning_tasks DROP COLUMN source;
ALTER TABLE planner_settings
    DROP CONSTRAINT auto_plan_range_is_offered,
    DROP COLUMN auto_plan_enabled,
    DROP COLUMN auto_plan_every_weeks,
    DROP COLUMN auto_plan_weekday,
    DROP COLUMN auto_plan_time,
    DROP COLUMN auto_plan_start_date,
    DROP COLUMN auto_plan_range_unit,
    DROP COLUMN auto_plan_range_count,
    DROP COLUMN auto_plan_armed_at,
    DROP COLUMN auto_plan_last_run_on,
    DROP COLUMN auto_plan_last_outcome,
    DROP COLUMN auto_plan_last_note,
    DROP COLUMN auto_plan_last_task_id,
    DROP COLUMN auto_plan_last_started_at;
