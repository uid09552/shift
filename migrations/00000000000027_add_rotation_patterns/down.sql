DROP INDEX IF EXISTS idx_employee_shift_assignments_tenant_date;
DROP TABLE IF EXISTS rotation_patterns;
DELETE FROM employee_shift_assignments WHERE shift_id IS NULL;
ALTER TABLE employee_shift_assignments ALTER COLUMN shift_id SET NOT NULL;
