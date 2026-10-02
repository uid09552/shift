-- Recurring open/close schedule for the shift-wish window. While
-- schedule_enabled, a background job opens the window ('enabled') on every
-- occurrence and closes it ('disabled') schedule_open_days later. Times are UTC.
--
--   days   — every `interval` days from schedule_start_date
--   weeks  — every `interval` weeks, on schedule_weekday (0 = Monday)
--   months — every `interval` months, on schedule_day_of_month (clamped to the
--            month's last day)
--
-- schedule_applied_open is the state the job last wrote, so a manual change
-- survives until the next open/close boundary and replicas do not apply twice.

ALTER TABLE wish_settings
    ADD COLUMN schedule_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN schedule_unit VARCHAR(16) NOT NULL DEFAULT 'weeks'
        CHECK (schedule_unit IN ('days', 'weeks', 'months')),
    ADD COLUMN schedule_interval INTEGER NOT NULL DEFAULT 1
        CHECK (schedule_interval BETWEEN 1 AND 365),
    ADD COLUMN schedule_weekday SMALLINT NOT NULL DEFAULT 0
        CHECK (schedule_weekday BETWEEN 0 AND 6),
    ADD COLUMN schedule_day_of_month SMALLINT NOT NULL DEFAULT 1
        CHECK (schedule_day_of_month BETWEEN 1 AND 31),
    ADD COLUMN schedule_time TIME NOT NULL DEFAULT '00:00',
    ADD COLUMN schedule_open_days INTEGER NOT NULL DEFAULT 7
        CHECK (schedule_open_days BETWEEN 1 AND 366),
    ADD COLUMN schedule_start_date DATE,
    ADD COLUMN schedule_applied_open BOOLEAN;
