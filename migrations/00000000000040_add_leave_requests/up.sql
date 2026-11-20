-- Leave (vacation) requests: an employee asks for a date range off, a planner
-- or admin approves or rejects it.
--
--   pending   → a planner approves (approved) or rejects (rejected),
--               or the requester cancels (cancelled)
--   approved  → a planner revokes it (revoked)
--
-- Approving writes one hard unavailability per day (and its roster mirror, like
-- any absence); `leave_request_days` remembers which ones, so a revoke removes
-- exactly those and never an absence someone entered by hand. Pending leave
-- reaches the optimizer as a soft "would rather be off".
CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    note TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'revoked')),
    -- Who made the last decision, as the audit log names them, and what they said.
    decided_by VARCHAR,
    decision_comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_tenant_status ON leave_requests (tenant_id, status);
CREATE INDEX idx_leave_requests_employee ON leave_requests (employee_id, start_date);

CREATE TABLE leave_request_days (
    leave_request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
    unavailability_id UUID NOT NULL REFERENCES unavailabilities(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    PRIMARY KEY (leave_request_id, unavailability_id)
);

-- Periods in which no leave can be requested (e.g. the Christmas weeks).
CREATE TABLE leave_blackouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_blackouts_tenant ON leave_blackouts (tenant_id, start_date);

-- At most `max_absent` people holding the capability may be absent on one day.
-- Reported as a warning to whoever decides; it never blocks a request.
CREATE TABLE leave_limits (
    tenant_id VARCHAR NOT NULL,
    capability_id UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    max_absent INTEGER NOT NULL CHECK (max_absent >= 0),
    PRIMARY KEY (tenant_id, capability_id)
);
