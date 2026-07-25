ALTER TABLE planner_settings DROP COLUMN shift_continuity_week_bonus;
ALTER TABLE planner_settings DROP COLUMN shift_continuity_weight;
ALTER TABLE planner_settings DROP COLUMN night_shift_fatigue_multiplier;
ALTER TABLE planner_settings DROP COLUMN fatigue_weight;
ALTER TABLE planner_settings DROP COLUMN skill_downgrade_weight;
ALTER TABLE planner_settings DROP COLUMN preference_weight;
ALTER TABLE planner_settings DROP COLUMN weekly_hours_target_weight;
ALTER TABLE planner_settings DROP COLUMN weekly_max_hours;
ALTER TABLE planner_settings DROP COLUMN weekly_min_hours;

ALTER TABLE unavailabilities DROP COLUMN is_soft_preference;

ALTER TABLE capabilities DROP COLUMN skill_group;
ALTER TABLE capabilities DROP COLUMN level;
