ALTER TABLE shift_weekday_times
    DROP COLUMN IF EXISTS min_employees,
    DROP COLUMN IF EXISTS max_employees;
