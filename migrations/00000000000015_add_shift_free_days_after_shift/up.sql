-- Number of consecutive days an employee should be kept free/rest after working
-- this shift on this weekday (0-5, default 0 = no forced recovery days).
ALTER TABLE shift_weekday_times
    ADD COLUMN free_days_after_shift SMALLINT NOT NULL DEFAULT 0;
