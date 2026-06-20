-- Add order column to shifts table
ALTER TABLE shifts ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Create index for ordering shifts
CREATE INDEX idx_shifts_order ON shifts("order");
