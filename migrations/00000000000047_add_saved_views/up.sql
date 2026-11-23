-- Named filter sets a user keeps for a page (the Schedule page for now): which
-- workstations, capabilities and people it shows and in which view. A user is a
-- Keycloak account, not a row here, so views are keyed by the token's subject.
-- `shared` views are offered to everyone in the tenant; only their owner (or an
-- admin) changes or deletes them.
CREATE TABLE saved_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR NOT NULL,
    owner_subject VARCHAR NOT NULL,
    owner_name VARCHAR,
    page VARCHAR(32) NOT NULL,
    name VARCHAR(80) NOT NULL CHECK (length(btrim(name)) > 0),
    filters JSONB NOT NULL DEFAULT '{}',
    shared BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_saved_views_name ON saved_views (tenant_id, owner_subject, page, lower(name));
CREATE INDEX idx_saved_views_page ON saved_views (tenant_id, page);

-- Per user and page: the view the page opens with, and the one last applied.
-- Either may be a shared view of someone else; deleting it clears the choice.
CREATE TABLE saved_view_preferences (
    tenant_id VARCHAR NOT NULL,
    user_subject VARCHAR NOT NULL,
    page VARCHAR(32) NOT NULL,
    default_view_id UUID REFERENCES saved_views(id) ON DELETE SET NULL,
    last_view_id UUID REFERENCES saved_views(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_subject, page)
);
