-- Add short_name and color columns to shifts table
ALTER TABLE shifts ADD COLUMN short_name VARCHAR(10) NOT NULL DEFAULT '';
ALTER TABLE shifts ADD COLUMN color VARCHAR(7) NOT NULL DEFAULT '#6B7280';
