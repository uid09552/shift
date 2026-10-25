-- The use case a ward picked on the planner settings page (balanced, fairness,
-- wishes, ...). The page's templates fill in the weights; this remembers which
-- one was chosen. It is a label only: the optimizer never sees it, and the
-- values stay the source of truth. NULL = none chosen (custom).
--
-- A slug rather than an enum or a CHECK list, because the templates live in the
-- UI and a new one must not need a migration; the service validates the shape.
ALTER TABLE planner_settings
    ADD COLUMN use_case VARCHAR(40);
