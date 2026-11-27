DROP TABLE workstation_demand;
ALTER TABLE planner_settings DROP COLUMN fairness_weight;
ALTER TABLE planner_settings DROP COLUMN fairness_horizon_months;
DROP TABLE on_call_call_ins;
ALTER TABLE employee_personal_limits DROP COLUMN max_on_call_per_month;
ALTER TABLE shifts DROP COLUMN duty_type;
