-- Whether the planner keeps employees' fixed assignments (what rotation
-- patterns write, see employee_shift_assignments) ahead of every other goal,
-- or plans as if there were none. On by default: that is how every tenant has
-- planned since rotations were introduced. See planner/shift_planner/optimizer.py
-- (_add_fixed_assignments).
ALTER TABLE planner_settings
    ADD COLUMN keep_fixed_assignments BOOLEAN NOT NULL DEFAULT TRUE;
