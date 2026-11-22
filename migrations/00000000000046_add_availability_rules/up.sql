-- Standing availability per employee: "only early shifts", "never Wednesdays",
-- "part-time on Mon/Tue/Thu". Hard or soft each, optionally for a date range.
-- The backend expands them over a planning period into what the solver and the
-- agent already know: hard weekday rules into whole-day unavailability, hard
-- shift rules into blocked shifts, soft ones into preferred days off.
--   only_shifts:   works only the listed shifts
--   not_shifts:    never works the listed shifts
--   only_weekdays: works only on the listed weekdays (0 = Monday … 6 = Sunday)
--   not_weekdays:  never works on the listed weekdays
CREATE TABLE availability_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('only_shifts', 'not_shifts', 'only_weekdays', 'not_weekdays')),
    shift_ids UUID[] NOT NULL DEFAULT '{}',
    weekdays SMALLINT[] NOT NULL DEFAULT '{}',
    mode VARCHAR(8) NOT NULL DEFAULT 'hard' CHECK (mode IN ('hard', 'soft')),
    valid_from DATE,
    valid_until DATE,
    note VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

CREATE INDEX idx_availability_rules_employee ON availability_rules (tenant_id, employee_id);
