-- Back to monthly hours. Employees that followed the default return to 0.
ALTER TABLE planner_settings DROP COLUMN default_weekly_working_hours;

ALTER TABLE employees ADD COLUMN monthly_working_hours DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE employees
SET monthly_working_hours = round((coalesce(weekly_working_hours, 0) * 52 / 12)::numeric, 1);

ALTER TABLE employees DROP COLUMN weekly_working_hours;
