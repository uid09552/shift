-- Create workstations table
CREATE TABLE workstations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    available BOOLEAN NOT NULL DEFAULT TRUE,
    active_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL
);

-- Workstation required capabilities relationship
CREATE TABLE workstation_required_capabilities (
    workstation_id UUID NOT NULL REFERENCES workstations(id) ON DELETE CASCADE,
    capability_id UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    PRIMARY KEY (workstation_id, capability_id)
);
