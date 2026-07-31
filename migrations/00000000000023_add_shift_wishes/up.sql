-- Employee shift wishes: an employee's request to work a specific shift on a
-- specific date. Unlike confirmed_shift_plans these are not commitments — the
-- optimizer treats them as a soft reward (wish_weight) when building a plan.
CREATE TABLE shift_wishes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    wish_date DATE NOT NULL,
    tenant_id VARCHAR NOT NULL DEFAULT '0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (employee_id, wish_date)
);

CREATE INDEX idx_shift_wishes_employee_id ON shift_wishes(employee_id);
CREATE INDEX idx_shift_wishes_wish_date ON shift_wishes(wish_date);
