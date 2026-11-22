-- A capability an employee holds may lapse (a resuscitation certificate, a
-- driving licence): its last valid day. After it the solver, the plan check and
-- open shifts no longer count it; planners see it coming. NULL = no expiry.
ALTER TABLE employee_capabilities ADD COLUMN valid_until DATE;
CREATE INDEX idx_employee_capabilities_valid_until ON employee_capabilities (tenant_id, valid_until) WHERE valid_until IS NOT NULL;
