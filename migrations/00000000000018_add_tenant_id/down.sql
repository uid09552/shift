ALTER TABLE confirmed_shift_plans DROP CONSTRAINT confirmed_shift_plans_tenant_id_employee_id_date_key;
ALTER TABLE confirmed_shift_plans ADD CONSTRAINT confirmed_shift_plans_employee_id_date_key UNIQUE (employee_id, date);

ALTER TABLE workstation_unavailabilities DROP CONSTRAINT workstation_unavailabilities_tenant_id_workstation_id_unav_key;
ALTER TABLE workstation_unavailabilities ADD CONSTRAINT workstation_unavailabilities_workstation_id_unavailable_fro_key UNIQUE (workstation_id, unavailable_from, unavailable_to);

ALTER TABLE employee_shift_assignments DROP CONSTRAINT employee_shift_assignments_tenant_id_employee_id_date_key;
ALTER TABLE employee_shift_assignments ADD CONSTRAINT employee_shift_assignments_employee_id_date_key UNIQUE (employee_id, date);

ALTER TABLE shift_weekday_times DROP CONSTRAINT shift_weekday_times_tenant_id_shift_id_weekday_key;
ALTER TABLE shift_weekday_times ADD CONSTRAINT shift_weekday_times_shift_id_weekday_key UNIQUE (shift_id, weekday);

ALTER TABLE unavailabilities DROP CONSTRAINT unavailabilities_tenant_id_employee_id_unavailable_date_s_key;
ALTER TABLE unavailabilities ADD CONSTRAINT unavailabilities_employee_id_unavailable_date_shift_id_key UNIQUE (employee_id, unavailable_date, shift_id);

ALTER TABLE capabilities DROP CONSTRAINT capabilities_tenant_id_name_key;
ALTER TABLE capabilities ADD CONSTRAINT capabilities_name_key UNIQUE (name);

ALTER TABLE shifts DROP CONSTRAINT shifts_tenant_id_name_key;
ALTER TABLE shifts ADD CONSTRAINT shifts_name_key UNIQUE (name);

ALTER TABLE employees DROP CONSTRAINT employees_tenant_id_email_key;
ALTER TABLE employees ADD CONSTRAINT employees_email_key UNIQUE (email);

DROP INDEX IF EXISTS idx_planning_tasks_tenant_id;
DROP INDEX IF EXISTS idx_optimized_shift_results_tenant_id;
DROP INDEX IF EXISTS idx_confirmed_shift_plans_tenant_id;
DROP INDEX IF EXISTS idx_employee_shift_assignments_tenant_id;
DROP INDEX IF EXISTS idx_unavailabilities_tenant_id;
DROP INDEX IF EXISTS idx_employee_capabilities_tenant_id;
DROP INDEX IF EXISTS idx_employee_available_shifts_tenant_id;
DROP INDEX IF EXISTS idx_workstation_required_capabilities_tenant_id;
DROP INDEX IF EXISTS idx_workstation_unavailabilities_tenant_id;
DROP INDEX IF EXISTS idx_workstations_tenant_id;
DROP INDEX IF EXISTS idx_capabilities_tenant_id;
DROP INDEX IF EXISTS idx_shift_weekday_times_tenant_id;
DROP INDEX IF EXISTS idx_shifts_tenant_id;
DROP INDEX IF EXISTS idx_employees_tenant_id;

ALTER TABLE planning_tasks DROP COLUMN tenant_id;
ALTER TABLE optimized_shift_results DROP COLUMN tenant_id;
ALTER TABLE confirmed_shift_plans DROP COLUMN tenant_id;
ALTER TABLE employee_shift_assignments DROP COLUMN tenant_id;
ALTER TABLE unavailabilities DROP COLUMN tenant_id;
ALTER TABLE employee_capabilities DROP COLUMN tenant_id;
ALTER TABLE employee_available_shifts DROP COLUMN tenant_id;
ALTER TABLE workstation_required_capabilities DROP COLUMN tenant_id;
ALTER TABLE workstation_unavailabilities DROP COLUMN tenant_id;
ALTER TABLE workstations DROP COLUMN tenant_id;
ALTER TABLE capabilities DROP COLUMN tenant_id;
ALTER TABLE shift_weekday_times DROP COLUMN tenant_id;
ALTER TABLE shifts DROP COLUMN tenant_id;
ALTER TABLE employees DROP COLUMN tenant_id;
