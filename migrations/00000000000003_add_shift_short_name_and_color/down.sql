-- Remove short_name and color columns from shifts table
ALTER TABLE shifts DROP COLUMN color;
ALTER TABLE shifts DROP COLUMN short_name;
