-- Create employee_shift_assignments table for storing fixed shift assignments
CREATE TABLE employee_shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    UNIQUE (employee_id, date)
);

-- Index for fast lookups by employee and date range
CREATE INDEX idx_employee_shift_assignments_employee_date ON employee_shift_assignments (employee_id, date);
