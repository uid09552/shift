-- Allow more than one employee to be scheduled at the same workstation per shift,
-- with optional min (soft) / max (hard) staffing limits.
-- min_employees: at least this many employees should be scheduled (default 1, soft).
-- max_employees: at most this many employees may be scheduled (NULL = no limit).
ALTER TABLE workstations
    ADD COLUMN min_employees SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN max_employees SMALLINT NULL DEFAULT NULL;
