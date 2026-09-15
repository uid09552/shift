-- A fixed day off: a fixed assignment without a shift. Rotation patterns write
-- their off days this way, so a rhythm like "night, night, off, off" reaches
-- the planner whole instead of as working days only.
ALTER TABLE employee_shift_assignments ALTER COLUMN shift_id DROP NOT NULL;

-- A named rhythm: one slot per day of the cycle, each a shift id or null for a
-- day off. The cycle length is the number of slots. Applying a pattern writes
-- ordinary employee_shift_assignments; the pattern itself is only the recipe.
CREATE TABLE rotation_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    slots JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rotation_patterns_slots_array CHECK (jsonb_typeof(slots) = 'array'),
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_employee_shift_assignments_tenant_date ON employee_shift_assignments (tenant_id, date);
