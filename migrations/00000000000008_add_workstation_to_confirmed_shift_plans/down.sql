DROP INDEX IF EXISTS idx_confirmed_shift_plans_workstation_id;
ALTER TABLE confirmed_shift_plans DROP COLUMN IF EXISTS workstation_id;
