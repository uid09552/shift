-- Public holidays fetched from the configured holiday API. A holiday runs on its
-- shifts' Sunday times and counts as a weekend day (see the planner).
CREATE TABLE public_holidays (
    tenant_id VARCHAR NOT NULL,
    holiday_date DATE NOT NULL,
    name VARCHAR NOT NULL,
    -- Federal state the date was fetched for, e.g. 'by'.
    state VARCHAR(8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, holiday_date)
);
