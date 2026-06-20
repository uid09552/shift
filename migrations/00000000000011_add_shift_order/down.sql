-- Remove order column from shifts table
DROP INDEX IF EXISTS idx_shifts_order;
ALTER TABLE shifts DROP COLUMN "order";
