-- E-mail notifications. Nothing is sent inline: events write rows to the outbox
-- and a worker delivers them with retries, so a mail problem never fails (or
-- slows down) the action that caused it. With no SMTP host configured nothing
-- is queued at all.

-- Per employee: all events are on until someone turns them off.
CREATE TABLE notification_preferences (
    employee_id UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    tenant_id VARCHAR NOT NULL,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    muted_events TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    recipient VARCHAR NOT NULL,
    event VARCHAR(32) NOT NULL,
    subject VARCHAR NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX idx_notification_outbox_due ON notification_outbox (status, next_attempt_at);
CREATE INDEX idx_notification_outbox_tenant ON notification_outbox (tenant_id, created_at);

-- Roster change notices already turned into mail. A sweep mails the rest, one
-- message per employee, so a bulk edit does not send a mail per day. Notices
-- that exist today are marked done: switching mail on must not announce history.
CREATE TABLE roster_notice_deliveries (
    notice_id UUID PRIMARY KEY REFERENCES roster_change_notices(id) ON DELETE CASCADE,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO roster_notice_deliveries (notice_id) SELECT id FROM roster_change_notices;
