-- Personal limits: what one employee may be planned for beyond the ward's rules
-- (pregnancy, age, a part-time agreement). At most one row per employee; no row
-- means no personal limits. See planner/shift_planner/optimizer.py
-- (_add_personal_limits).
CREATE TABLE employee_personal_limits (
    employee_id UUID PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
    tenant_id VARCHAR NOT NULL,
    -- Night shifts per calendar month; NULL = no personal limit.
    max_nights_per_month SMALLINT CHECK (max_nights_per_month BETWEEN 0 AND 31),
    -- Weekends (Saturday/Sunday, one or both worked) per calendar month.
    max_weekends_per_month SMALLINT CHECK (max_weekends_per_month BETWEEN 0 AND 5),
    -- Never on a night shift. Always a hard rule, whatever personal_limits_mode says.
    no_night_shifts BOOLEAN NOT NULL DEFAULT FALSE,
    -- Weekdays they would rather have off, 0 = Monday … 6 = Sunday. Soft, like
    -- a preferred day off.
    preferred_days_off SMALLINT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_employee_personal_limits_tenant ON employee_personal_limits (tenant_id);

-- Whether max_nights_per_month / max_weekends_per_month are limits the solver
-- may not break ('hard', the default: they protect people) or targets it breaks
-- at a penalty when a slot would otherwise stay empty ('soft').
ALTER TABLE planner_settings
    ADD COLUMN personal_limits_mode VARCHAR(16) NOT NULL DEFAULT 'hard'
        CHECK (personal_limits_mode IN ('soft', 'hard'));
