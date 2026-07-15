-- Per-tenant configuration for the shift optimizer (CP-SAT) algorithm.
-- One row per tenant; created on first read/write with defaults matching the
-- planner's ConstraintConfig defaults (see planner/shift_planner/models.py).

CREATE TABLE planner_settings (
    tenant_id VARCHAR(255) PRIMARY KEY,
    night_shift_recovery_days SMALLINT NOT NULL DEFAULT 2,
    min_rest_hours DOUBLE PRECISION NOT NULL DEFAULT 11.0,
    max_consecutive_days SMALLINT NOT NULL DEFAULT 6,
    max_working_days_per_week SMALLINT NOT NULL DEFAULT 5,
    equality_weight INTEGER NOT NULL DEFAULT 50000,
    priority_weight_high INTEGER NOT NULL DEFAULT 10000,
    priority_weight_medium INTEGER NOT NULL DEFAULT 1000,
    priority_weight_low INTEGER NOT NULL DEFAULT 100,
    monthly_hours_target_weight INTEGER NOT NULL DEFAULT 1000,
    solver_time_limit_seconds DOUBLE PRECISION NOT NULL DEFAULT 120.0,
    solver_num_workers SMALLINT NOT NULL DEFAULT 8,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
