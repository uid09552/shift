ALTER TABLE workstations
    DROP COLUMN IF EXISTS min_employees,
    DROP COLUMN IF EXISTS max_employees;
