ALTER TABLE confirmed_shift_plans DROP CONSTRAINT valid_absence_type;
ALTER TABLE confirmed_shift_plans ADD CONSTRAINT valid_absence_type CHECK (
    absence_type IS NULL OR absence_type IN ('sick', 'day_off', 'holiday', 'unknown')
);
