-- Float / pool staff: an employee's home workstation (optional), whether they
-- are pool staff who float between wards, and a cap on the days per calendar
-- month a non-pool employee may be lent out (worked on another workstation).
-- Kept with the personal limits: same editor, same audit trail, same
-- hand-over to the solver. Deleting a workstation clears the home reference.
ALTER TABLE employee_personal_limits
    ADD COLUMN home_workstation_id UUID REFERENCES workstations (id) ON DELETE SET NULL,
    ADD COLUMN is_pool BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN max_lent_per_month SMALLINT
        CHECK (max_lent_per_month IS NULL OR max_lent_per_month BETWEEN 0 AND 31);

CREATE INDEX idx_employee_personal_limits_home ON employee_personal_limits (home_workstation_id);
