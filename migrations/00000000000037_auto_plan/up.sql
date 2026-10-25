-- Automatic planning: a schedule per tenant that runs the optimizer on its own
-- and, when the plan is clean, takes it over as the confirmed roster.
-- Everything is off by default, so an upgrade changes nothing until a planner
-- switches the schedule on. See openspec/changes/auto-plan-schedule.
ALTER TABLE planner_settings
    ADD COLUMN auto_plan_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Weeks between runs.
    ADD COLUMN auto_plan_every_weeks SMALLINT NOT NULL DEFAULT 4
        CHECK (auto_plan_every_weeks BETWEEN 1 AND 12),
    -- 0 = Monday ... 6 = Sunday, as the wish schedule counts.
    ADD COLUMN auto_plan_weekday SMALLINT NOT NULL DEFAULT 0
        CHECK (auto_plan_weekday BETWEEN 0 AND 6),
    -- Server local time.
    ADD COLUMN auto_plan_time TIME NOT NULL DEFAULT '02:00',
    -- The first run day on or after this date; also anchors the interval.
    ADD COLUMN auto_plan_start_date DATE,
    -- How far ahead one run plans: 2, 4, 6, 8 or 12 weeks, or 1, 2 or 3 months.
    ADD COLUMN auto_plan_range_unit VARCHAR(8) NOT NULL DEFAULT 'weeks'
        CHECK (auto_plan_range_unit IN ('weeks', 'months')),
    ADD COLUMN auto_plan_range_count SMALLINT NOT NULL DEFAULT 4,
    ADD CONSTRAINT auto_plan_range_is_offered CHECK (
        (auto_plan_range_unit = 'weeks' AND auto_plan_range_count IN (2, 4, 6, 8, 12))
        OR (auto_plan_range_unit = 'months' AND auto_plan_range_count IN (1, 2, 3))
    ),
    -- When the schedule was last switched on or changed: a run day whose time
    -- had passed by then does not run. Server local time, like the run time.
    ADD COLUMN auto_plan_armed_at TIMESTAMP,
    -- Written by the background job only: the run day last claimed and what came of it.
    ADD COLUMN auto_plan_last_run_on DATE,
    ADD COLUMN auto_plan_last_outcome VARCHAR(24)
        CHECK (auto_plan_last_outcome IN ('running', 'taken_over', 'kept_as_proposal', 'skipped', 'failed')),
    ADD COLUMN auto_plan_last_note TEXT,
    ADD COLUMN auto_plan_last_task_id UUID,
    -- When the last run started (server local time): a run still 'running' hours
    -- later is failed, so a lost answer does not leave the page saying 'running'.
    ADD COLUMN auto_plan_last_started_at TIMESTAMP;

-- Who asked for a plan run: a person ('manual') or the schedule ('auto').
ALTER TABLE planning_tasks
    ADD COLUMN source VARCHAR(8) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'auto'));
