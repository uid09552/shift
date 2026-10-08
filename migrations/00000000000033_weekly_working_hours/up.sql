-- Contracted hours become weekly, and optional: NULL follows the tenant's
-- planner_settings.default_weekly_working_hours (40 unless changed); 0 still
-- means "no hours target"; anything else is the employee's own value.
--
-- Existing monthly values are converted as monthly × 12 / 52, rounded to the
-- nearest 0.5 (160 → 37). Employees at 0 were never given hours, so they follow
-- the default from now on — a ward that used 0 to mean "no target" has to set 0
-- again.
ALTER TABLE employees ADD COLUMN weekly_working_hours DOUBLE PRECISION
    CHECK (weekly_working_hours >= 0 AND weekly_working_hours <= 168);

UPDATE employees
SET weekly_working_hours = round((monthly_working_hours * 12 / 52 * 2)::numeric) / 2
WHERE monthly_working_hours > 0;

ALTER TABLE employees DROP COLUMN monthly_working_hours;

ALTER TABLE planner_settings ADD COLUMN default_weekly_working_hours DOUBLE PRECISION NOT NULL DEFAULT 40
    CHECK (default_weekly_working_hours > 0 AND default_weekly_working_hours <= 168);
