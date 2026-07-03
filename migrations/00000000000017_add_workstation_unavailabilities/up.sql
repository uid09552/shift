-- Periods during which a workstation is unavailable for planning (e.g. maintenance,
-- renovation). Stored as inclusive date ranges.
CREATE TABLE workstation_unavailabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workstation_id UUID NOT NULL REFERENCES workstations(id) ON DELETE CASCADE,
    unavailable_from DATE NOT NULL,
    unavailable_to DATE NOT NULL,
    CONSTRAINT workstation_unavailabilities_valid_range CHECK (unavailable_to >= unavailable_from),
    UNIQUE (workstation_id, unavailable_from, unavailable_to)
);

CREATE INDEX idx_workstation_unavailabilities_workstation_id ON workstation_unavailabilities(workstation_id);
