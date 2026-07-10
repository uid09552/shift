-- The API has always accepted 'unavailable' and 'free' as absence_type values
-- (see valid_absence_type validation in services/confirmed_shift_plan.rs), but the
-- DB check constraint was never widened to match, so any create/update using those
-- values (e.g. "Take as Plan" marking free days) failed with a check violation.
ALTER TABLE confirmed_shift_plans DROP CONSTRAINT valid_absence_type;
ALTER TABLE confirmed_shift_plans ADD CONSTRAINT valid_absence_type CHECK (
    absence_type IS NULL OR absence_type IN ('sick', 'day_off', 'holiday', 'unknown', 'unavailable', 'free')
);
