-- Adds the settings/data needed to implement the nurse-scheduling paper's
-- objectives (Khalili et al. 2020) on top of the existing CP-SAT optimizer:
-- skill-downgrade cost, soft shift/day preferences, weekly hour bands, and a
-- fatigue-aware (ergonomic) objective. See planner/shift_planner/models.py
-- (ConstraintConfig, Employee.preferred_off, CapabilityInfo) for the
-- corresponding optimizer-side fields.

-- Skill-level metadata for the skill-downgrade objective. Capabilities that
-- share a skill_group are substitutable tiers of the same skill; level=1 and
-- skill_group=NULL for every existing row means no tenant sees any behaviour
-- change until they deliberately group and rank capabilities.
ALTER TABLE capabilities ADD COLUMN level SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE capabilities ADD COLUMN skill_group VARCHAR(255);

-- Marks an unavailability row as a soft preference (the optimizer may still
-- assign it under pressure, at a penalty) rather than a hard block. Existing
-- rows default to false, i.e. remain hard as before.
ALTER TABLE unavailabilities ADD COLUMN is_soft_preference BOOLEAN NOT NULL DEFAULT false;

-- New tunable weights/bands, mirroring ConstraintConfig defaults in
-- planner/shift_planner/models.py.
ALTER TABLE planner_settings ADD COLUMN weekly_min_hours DOUBLE PRECISION;
ALTER TABLE planner_settings ADD COLUMN weekly_max_hours DOUBLE PRECISION;
ALTER TABLE planner_settings ADD COLUMN weekly_hours_target_weight INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE planner_settings ADD COLUMN preference_weight INTEGER NOT NULL DEFAULT 300;
ALTER TABLE planner_settings ADD COLUMN skill_downgrade_weight INTEGER NOT NULL DEFAULT 200;
ALTER TABLE planner_settings ADD COLUMN fatigue_weight INTEGER NOT NULL DEFAULT 100;
ALTER TABLE planner_settings ADD COLUMN night_shift_fatigue_multiplier DOUBLE PRECISION NOT NULL DEFAULT 2.0;

-- Previously hardcoded in the Python optimizer's defaults only (never
-- actually configurable per tenant despite ConstraintConfig documenting them).
ALTER TABLE planner_settings ADD COLUMN shift_continuity_weight INTEGER NOT NULL DEFAULT 500;
ALTER TABLE planner_settings ADD COLUMN shift_continuity_week_bonus INTEGER NOT NULL DEFAULT 2000;
