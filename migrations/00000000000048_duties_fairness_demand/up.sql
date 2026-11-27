-- On-call and standby duties: a shift's duty type. `standby` is on-site
-- standby (Bereitschaftsdienst, working time — up to 24 h a day under the
-- arbzg_de profile), `on_call` is on call from home (Rufbereitschaft, rest time
-- until called in).
ALTER TABLE shifts ADD COLUMN duty_type VARCHAR(16) NOT NULL DEFAULT 'regular'
    CHECK (duty_type IN ('regular', 'standby', 'on_call'));

-- An employee's cap on on-call duties per calendar month (personal limits).
ALTER TABLE employee_personal_limits ADD COLUMN max_on_call_per_month SMALLINT
    CHECK (max_on_call_per_month IS NULL OR max_on_call_per_month BETWEEN 0 AND 31);

-- Minutes actually called in on an on-call duty, recorded afterwards. Keyed by
-- employee and day rather than by roster row: the row is rewritten by every
-- roster write, the call-in is a fact about the day.
CREATE TABLE on_call_call_ins (
    tenant_id VARCHAR NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
    note VARCHAR,
    recorded_by VARCHAR,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, date)
);
CREATE INDEX idx_on_call_call_ins_tenant ON on_call_call_ins (tenant_id, date);

-- Long-term fairness: how far back the duty balance reaches (months, 0 = off)
-- and its weight in the optimizer.
ALTER TABLE planner_settings ADD COLUMN fairness_horizon_months SMALLINT NOT NULL DEFAULT 6
    CHECK (fairness_horizon_months BETWEEN 0 AND 24);
ALTER TABLE planner_settings ADD COLUMN fairness_weight INTEGER NOT NULL DEFAULT 2000
    CHECK (fairness_weight >= 0);

-- Staffing demand by hour: headcount per hour of a weekday at a workstation
-- (0 = Monday … 6 = Sunday, which public holidays use too). A weekday with a
-- curve replaces the workstation's per-shift minimum on that day.
CREATE TABLE workstation_demand (
    tenant_id VARCHAR NOT NULL,
    workstation_id UUID NOT NULL REFERENCES workstations(id) ON DELETE CASCADE,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    hours SMALLINT[] NOT NULL CHECK (array_length(hours, 1) = 24),
    PRIMARY KEY (workstation_id, weekday)
);
