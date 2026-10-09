-- Each calendar month of a tenant's confirmed roster is draft, published or
-- locked. A month without a row is draft. The status read by the API is
-- *effective*: a published month whose last day has passed reads as locked,
-- unless an admin reopened (unlocked) it — no background job flips it.
--
--   draft     → planners publish it (published_at/by recorded)
--   published → admins unpublish it (draft) or lock it once it has ended
--   locked    → admins unlock it (published, reopened = true)
CREATE TABLE roster_months (
    tenant_id VARCHAR NOT NULL,
    -- First day of the month.
    month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    status VARCHAR(16) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'locked')),
    published_at TIMESTAMPTZ,
    published_by VARCHAR,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR,
    reopened BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, month)
);

-- One per employee and day whose confirmed entry changed in a published or
-- locked month. `before` / `after` hold {shift_id, workstation_id,
-- absence_type} or null (no entry). Not linked to the roster row: Take as Plan
-- deletes and re-creates rows, and a notice outlives later edits.
CREATE TABLE roster_change_notices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    before JSONB,
    after JSONB,
    source VARCHAR(16) NOT NULL
        CHECK (source IN ('manual', 'take_as_plan', 'absence', 'swap', 'replacement')),
    actor VARCHAR,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ
);

CREATE INDEX idx_roster_change_notices_employee ON roster_change_notices (tenant_id, employee_id, acknowledged_at);
CREATE INDEX idx_roster_change_notices_date ON roster_change_notices (tenant_id, date);

ALTER TABLE planner_settings
    ADD COLUMN publish_lead_days SMALLINT NOT NULL DEFAULT 28 CHECK (publish_lead_days >= 0 AND publish_lead_days <= 366),
    ADD COLUMN freeze_days SMALLINT NOT NULL DEFAULT 7 CHECK (freeze_days >= 0 AND freeze_days <= 366),
    ADD COLUMN change_weight INTEGER NOT NULL DEFAULT 100000 CHECK (change_weight >= 0);

-- Rosters that exist already have been seen by everyone: keep them visible.
INSERT INTO roster_months (tenant_id, month, status, published_at, locked_at)
SELECT DISTINCT
    tenant_id,
    date_trunc('month', date)::date,
    CASE WHEN date_trunc('month', date) + interval '1 month' <= date_trunc('day', now()) THEN 'locked' ELSE 'published' END,
    now(),
    CASE WHEN date_trunc('month', date) + interval '1 month' <= date_trunc('day', now()) THEN now() END
FROM confirmed_shift_plans;
