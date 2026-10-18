ALTER TABLE employee_personal_limits
    DROP COLUMN date_of_birth,
    DROP COLUMN maternity_protection;
ALTER TABLE shifts DROP COLUMN break_minutes;
ALTER TABLE planner_settings
    DROP COLUMN labor_law_profile,
    DROP COLUMN labor_law_averaging_weeks;
