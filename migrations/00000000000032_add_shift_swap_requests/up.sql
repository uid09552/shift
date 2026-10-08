-- A viewer's request to exchange one of their confirmed shifts for one of a
-- colleague's. The two roster rows are referenced by value (date, shift,
-- workstation), not by id: approval compares them with the roster as it is
-- then, and refuses (status 'stale') when either has changed meanwhile.
--
--   pending_colleague → the colleague accepts (pending_planner) or declines (rejected)
--   pending_planner   → a planner approves (approved, roster exchanged) or rejects (rejected)
--   either pending    → the requester cancels (cancelled), or the earlier date
--                       passes (expired, written lazily on read)
CREATE TABLE shift_swap_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    requester_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    requester_date DATE NOT NULL,
    requester_shift_id UUID NOT NULL,
    requester_workstation_id UUID,
    colleague_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    colleague_date DATE NOT NULL,
    colleague_shift_id UUID NOT NULL,
    colleague_workstation_id UUID,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_colleague'
        CHECK (status IN ('pending_colleague', 'pending_planner', 'approved',
                          'rejected', 'cancelled', 'expired', 'stale')),
    -- Who made the last decision (colleague, planner or requester), as the
    -- audit log names them.
    decided_by VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (requester_id <> colleague_id)
);

CREATE INDEX idx_shift_swap_requests_tenant_status ON shift_swap_requests (tenant_id, status);
