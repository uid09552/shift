-- Labor-law profile (ArbZG, JArbSchG, MuSchG). See planner/shift_planner/legal.py.
--
-- 'none' leaves every rule to the ward's own settings; 'arbzg_de' adds the legal
-- limits as hard rules and makes the plan check report them apart from soft goals.
ALTER TABLE planner_settings
    ADD COLUMN labor_law_profile VARCHAR(16) NOT NULL DEFAULT 'none'
        CHECK (labor_law_profile IN ('none', 'arbzg_de')),
    -- Reference period of the 48 h average (ArbZG §3: 24 weeks).
    ADD COLUMN labor_law_averaging_weeks SMALLINT NOT NULL DEFAULT 24
        CHECK (labor_law_averaging_weeks BETWEEN 1 AND 52);

-- Unpaid break inside a shift's start-end span; counted off its hours.
ALTER TABLE shifts
    ADD COLUMN break_minutes SMALLINT NOT NULL DEFAULT 0
        CHECK (break_minutes BETWEEN 0 AND 240);

-- Protected-group data lives with the other personal limits. Only a flag for
-- maternity protection is stored, never a due date; it is health-related data,
-- hidden from shift-viewer and left out of audit entries.
ALTER TABLE employee_personal_limits
    ADD COLUMN date_of_birth DATE,
    ADD COLUMN maternity_protection BOOLEAN NOT NULL DEFAULT FALSE;
