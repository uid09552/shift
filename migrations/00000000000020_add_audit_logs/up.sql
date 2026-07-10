-- Audit log store: one row per recorded event (user/config changes, optimizer runs).
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    -- Caller identity from the X-Userinfo header (APISIX OIDC plugin), when present.
    actor VARCHAR(255),
    -- e.g. "employee.create", "shift.update", "planner.optimize"
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id VARCHAR(100),
    -- Freeform description/diff of what changed (e.g. the request body as JSON).
    changes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
