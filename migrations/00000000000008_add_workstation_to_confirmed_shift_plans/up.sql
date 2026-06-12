-- Add workstation_id to confirmed_shift_plans
ALTER TABLE confirmed_shift_plans
    ADD COLUMN workstation_id UUID REFERENCES workstations(id) ON DELETE SET NULL;

-- Index for fast lookups by workstation
CREATE INDEX idx_confirmed_shift_plans_workstation_id ON confirmed_shift_plans (workstation_id) WHERE workstation_id IS NOT NULL;
