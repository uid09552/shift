-- Create optimized_shift_results table for storing planner optimization results (TaskResultDto)
CREATE TABLE optimized_shift_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    result JSONB NOT NULL,
    creation_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups ordered by creation date
CREATE INDEX idx_optimized_shift_results_creation_date ON optimized_shift_results (creation_date DESC);
