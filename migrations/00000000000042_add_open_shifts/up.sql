-- Open shifts: a slot nobody is planned on, offered to the people who could
-- take it. Qualified employees volunteer, a planner assigns one of them —
-- through the roster guard like any other roster write.
--
--   open    → a planner assigns a volunteer (filled) or withdraws it (closed)
--   filled / closed are final
CREATE TABLE open_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    date DATE NOT NULL,
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    workstation_id UUID REFERENCES workstations(id) ON DELETE CASCADE,
    note TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'filled', 'closed')),
    assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_by VARCHAR,
    decided_by VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open offer per slot at a time.
CREATE UNIQUE INDEX idx_open_shifts_one_open_per_slot
    ON open_shifts (tenant_id, date, shift_id, COALESCE(workstation_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE status = 'open';
CREATE INDEX idx_open_shifts_tenant_status ON open_shifts (tenant_id, status, date);

CREATE TABLE open_shift_volunteers (
    open_shift_id UUID NOT NULL REFERENCES open_shifts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (open_shift_id, employee_id)
);
