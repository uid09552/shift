-- Add composite index for analysis queries on confirmed_shift_plans
-- These indexes optimize the aggregation queries for planned hours and employees per day per workstation

-- Composite index for workstation + date range queries (analysis queries)
CREATE INDEX idx_confirmed_shift_plans_workstation_date_present
    ON confirmed_shift_plans (workstation_id, date, is_present)
    WHERE workstation_id IS NOT NULL AND is_present = true;

-- Composite index for date range + is_present filtering
CREATE INDEX idx_confirmed_shift_plans_date_present
    ON confirmed_shift_plans (date, is_present)
    WHERE is_present = true;
