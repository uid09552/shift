DROP INDEX IF EXISTS idx_employee_personal_limits_home;
ALTER TABLE employee_personal_limits
    DROP COLUMN max_lent_per_month,
    DROP COLUMN is_pool,
    DROP COLUMN home_workstation_id;
