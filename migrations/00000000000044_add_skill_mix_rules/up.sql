-- The ward's skill-mix and pairing rules (see planner/shift_planner/skill_mix.py).
-- Sent to the solver and the agent with every planning input; hard ones the
-- solver may not break, soft ones it breaks only where staffing needs it.

-- Per slot (day, shift; at one workstation or summed over all of them):
--   at_least: >= count people with the capability (or a higher level of its
--             group), or with any capability of skill_group at >= min_level
--   at_most:  <= count people holding the capability exactly
CREATE TABLE skill_mix_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('at_least', 'at_most')),
    count INTEGER NOT NULL CHECK (count >= 0),
    capability_id UUID REFERENCES capabilities(id) ON DELETE CASCADE,
    skill_group VARCHAR,
    min_level SMALLINT CHECK (min_level >= 1),
    shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
    workstation_id UUID REFERENCES workstations(id) ON DELETE CASCADE,
    mode VARCHAR(8) NOT NULL DEFAULT 'hard' CHECK (mode IN ('hard', 'soft')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (capability_id IS NOT NULL OR (skill_group IS NOT NULL AND min_level IS NOT NULL)),
    CHECK (kind = 'at_least' OR capability_id IS NOT NULL)
);

CREATE INDEX idx_skill_mix_rules_tenant ON skill_mix_rules (tenant_id);

--   mentor:   employee (the trainee) works only where partner (the mentor) works
--   together: on a day both work, the same shift
--   apart:    never the same shift on the same day
CREATE TABLE pairing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('mentor', 'together', 'apart')),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    mode VARCHAR(8) NOT NULL DEFAULT 'hard' CHECK (mode IN ('hard', 'soft')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (employee_id <> partner_id)
);

CREATE INDEX idx_pairing_rules_tenant ON pairing_rules (tenant_id);
