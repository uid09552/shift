-- Create confirmed_shift_plans table for storing confirmed shift plans per employee
CREATE TABLE confirmed_shift_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    is_present BOOLEAN NOT NULL DEFAULT TRUE,
    absence_type VARCHAR(20),
    creation_type VARCHAR(20) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, date),
    CONSTRAINT valid_absence_type CHECK (
        absence_type IS NULL OR absence_type IN ('sick', 'day_off', 'holiday', 'unknown')
    ),
    CONSTRAINT valid_creation_type CHECK (
        creation_type IN ('manual', 'automated')
    ),
    CONSTRAINT absence_only_when_not_present CHECK (
        is_present = TRUE OR absence_type IS NOT NULL
    )
);

-- Index for fast lookups by employee and date range
CREATE INDEX idx_confirmed_shift_plans_employee_date ON confirmed_shift_plans (employee_id, date);

-- Index for filtering by date
CREATE INDEX idx_confirmed_shift_plans_date ON confirmed_shift_plans (date);

-- Index for filtering by absence type
CREATE INDEX idx_confirmed_shift_plans_absence_type ON confirmed_shift_plans (absence_type) WHERE absence_type IS NOT NULL;
