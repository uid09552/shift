-- Create shift_weekday_times table
-- Stores start_time/end_time per weekday for each shift
-- weekday: 0 = Monday, 1 = Tuesday, ..., 6 = Sunday
CREATE TABLE shift_weekday_times (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    weekday SMALLINT NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    UNIQUE (shift_id, weekday)
);
