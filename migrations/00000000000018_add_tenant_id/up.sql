-- Add tenant_id to every table so all data can be scoped per tenant.
-- Default '0' matches the CLI's --dev-mode --tenant-id=0 default tenant.

ALTER TABLE employees ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE shifts ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE shift_weekday_times ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE capabilities ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE workstations ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE workstation_unavailabilities ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE workstation_required_capabilities ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE employee_available_shifts ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE employee_capabilities ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE unavailabilities ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE employee_shift_assignments ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE confirmed_shift_plans ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE optimized_shift_results ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';
ALTER TABLE planning_tasks ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT '0';

CREATE INDEX idx_employees_tenant_id ON employees(tenant_id);
CREATE INDEX idx_shifts_tenant_id ON shifts(tenant_id);
CREATE INDEX idx_shift_weekday_times_tenant_id ON shift_weekday_times(tenant_id);
CREATE INDEX idx_capabilities_tenant_id ON capabilities(tenant_id);
CREATE INDEX idx_workstations_tenant_id ON workstations(tenant_id);
CREATE INDEX idx_workstation_unavailabilities_tenant_id ON workstation_unavailabilities(tenant_id);
CREATE INDEX idx_workstation_required_capabilities_tenant_id ON workstation_required_capabilities(tenant_id);
CREATE INDEX idx_employee_available_shifts_tenant_id ON employee_available_shifts(tenant_id);
CREATE INDEX idx_employee_capabilities_tenant_id ON employee_capabilities(tenant_id);
CREATE INDEX idx_unavailabilities_tenant_id ON unavailabilities(tenant_id);
CREATE INDEX idx_employee_shift_assignments_tenant_id ON employee_shift_assignments(tenant_id);
CREATE INDEX idx_confirmed_shift_plans_tenant_id ON confirmed_shift_plans(tenant_id);
CREATE INDEX idx_optimized_shift_results_tenant_id ON optimized_shift_results(tenant_id);
CREATE INDEX idx_planning_tasks_tenant_id ON planning_tasks(tenant_id);

-- Re-scope business-key uniqueness constraints to be per-tenant.
ALTER TABLE employees DROP CONSTRAINT employees_email_key;
ALTER TABLE employees ADD CONSTRAINT employees_tenant_id_email_key UNIQUE (tenant_id, email);

ALTER TABLE shifts DROP CONSTRAINT shifts_name_key;
ALTER TABLE shifts ADD CONSTRAINT shifts_tenant_id_name_key UNIQUE (tenant_id, name);

ALTER TABLE capabilities DROP CONSTRAINT capabilities_name_key;
ALTER TABLE capabilities ADD CONSTRAINT capabilities_tenant_id_name_key UNIQUE (tenant_id, name);

ALTER TABLE unavailabilities DROP CONSTRAINT unavailabilities_employee_id_unavailable_date_shift_id_key;
ALTER TABLE unavailabilities ADD CONSTRAINT unavailabilities_tenant_id_employee_id_unavailable_date_s_key UNIQUE (tenant_id, employee_id, unavailable_date, shift_id);

ALTER TABLE shift_weekday_times DROP CONSTRAINT shift_weekday_times_shift_id_weekday_key;
ALTER TABLE shift_weekday_times ADD CONSTRAINT shift_weekday_times_tenant_id_shift_id_weekday_key UNIQUE (tenant_id, shift_id, weekday);

ALTER TABLE employee_shift_assignments DROP CONSTRAINT employee_shift_assignments_employee_id_date_key;
ALTER TABLE employee_shift_assignments ADD CONSTRAINT employee_shift_assignments_tenant_id_employee_id_date_key UNIQUE (tenant_id, employee_id, date);

ALTER TABLE workstation_unavailabilities DROP CONSTRAINT workstation_unavailabilities_workstation_id_unavailable_fro_key;
ALTER TABLE workstation_unavailabilities ADD CONSTRAINT workstation_unavailabilities_tenant_id_workstation_id_unav_key UNIQUE (tenant_id, workstation_id, unavailable_from, unavailable_to);

ALTER TABLE confirmed_shift_plans DROP CONSTRAINT confirmed_shift_plans_employee_id_date_key;
ALTER TABLE confirmed_shift_plans ADD CONSTRAINT confirmed_shift_plans_tenant_id_employee_id_date_key UNIQUE (tenant_id, employee_id, date);
