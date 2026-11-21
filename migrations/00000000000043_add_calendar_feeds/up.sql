-- A personal calendar feed (iCal) per employee: calendar apps subscribe to
-- /api/v1/calendar-feeds/<token>.ics without signing in, so the token is the
-- only key. Only its SHA-256 is stored; the link is shown once, when it is
-- made. Making a new one replaces (revokes) the old.
CREATE TABLE calendar_feeds (
    employee_id UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    tenant_id VARCHAR NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_fetched_at TIMESTAMPTZ
);
