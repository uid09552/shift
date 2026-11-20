-- When public holidays were last fetched, per tenant, year and state. Lets the
-- background refresh (`holidays.refresh_interval_days`) tell a stale year from a
-- fresh one after a restart or across instances, and lets a failing holiday API
-- be retried with a back-off instead of on every request. See issue #149.
CREATE TABLE holiday_syncs (
    tenant_id VARCHAR NOT NULL,
    year INTEGER NOT NULL,
    state VARCHAR NOT NULL,
    -- The last successful fetch; NULL while every attempt has failed.
    last_synced_at TIMESTAMPTZ,
    -- The last attempt, successful or not. The refresh job claims a due year by
    -- moving this with a compare-and-swap, so two instances never both fetch.
    last_attempt_at TIMESTAMPTZ NOT NULL,
    -- Failed attempts since the last success; drives the retry back-off.
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    PRIMARY KEY (tenant_id, year, state)
);
