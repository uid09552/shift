-- Per-tenant window governing when employees may place shift wishes
-- (see shift_wishes, added in migration 23). One row per tenant, created on
-- first read/write with wishing fully open, which is how the feature behaved
-- before this table existed.
--
-- mode:
--   'enabled'    — employees may wish for any date
--   'disabled'   — employees may not wish at all
--   'date_range' — employees may only wish for dates within
--                  [window_start, window_end] (both inclusive)
--
-- The window is stored even while another mode is active, so an admin can
-- switch back to 'date_range' without re-entering the dates. Only
-- self-service wishes are governed by it; shift-planner/shift-admin manage
-- wishes on anyone's behalf at any time.

CREATE TABLE wish_settings (
    tenant_id VARCHAR(255) PRIMARY KEY,
    mode VARCHAR(32) NOT NULL DEFAULT 'enabled'
        CHECK (mode IN ('enabled', 'disabled', 'date_range')),
    window_start DATE,
    window_end DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wish_settings_window_order CHECK (
        window_start IS NULL OR window_end IS NULL OR window_start <= window_end
    ),
    CONSTRAINT wish_settings_date_range_complete CHECK (
        mode <> 'date_range' OR (window_start IS NOT NULL AND window_end IS NOT NULL)
    )
);
