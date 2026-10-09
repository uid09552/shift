ALTER TABLE planner_settings
    DROP COLUMN publish_lead_days,
    DROP COLUMN freeze_days,
    DROP COLUMN change_weight;
DROP TABLE roster_change_notices;
DROP TABLE roster_months;
