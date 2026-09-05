-- Whether a shift's / workstation's `min_employees` is a target the solver is
-- penalised for missing ('soft', the behaviour every tenant had until now) or a
-- requirement it may not break ('hard'). Hard mode can make a month infeasible
-- when there simply aren't enough eligible employees, which is why 'soft'
-- stays the default. See planner/shift_planner/optimizer.py
-- (_limit_shift_staffing / _limit_workstation_staffing).
ALTER TABLE planner_settings
    ADD COLUMN min_staffing_mode VARCHAR(16) NOT NULL DEFAULT 'soft'
        CHECK (min_staffing_mode IN ('soft', 'hard'));
