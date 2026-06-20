-- Add minimum and maximum employee count constraints per shift per weekday.
-- min_employees: at least this many employees must be scheduled (default 1).
-- max_employees: at most this many employees may be scheduled (NULL = no limit).
ALTER TABLE shift_weekday_times
    ADD COLUMN min_employees SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN max_employees SMALLINT NULL DEFAULT NULL;
