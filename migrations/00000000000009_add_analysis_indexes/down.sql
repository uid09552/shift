-- Remove analysis-optimized indexes
DROP INDEX IF EXISTS idx_confirmed_shift_plans_workstation_date_present;
DROP INDEX IF EXISTS idx_confirmed_shift_plans_date_present;
