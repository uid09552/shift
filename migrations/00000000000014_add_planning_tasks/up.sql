CREATE TABLE planning_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR NOT NULL DEFAULT 'scheduled',
    payload JSONB NOT NULL,
    result_id UUID REFERENCES optimized_shift_results(id),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
