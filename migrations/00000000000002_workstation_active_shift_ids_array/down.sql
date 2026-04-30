-- Add back the old active_shift_id column
ALTER TABLE workstations ADD COLUMN active_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL;

-- Migrate data: take the first element of the array if any
UPDATE workstations SET active_shift_id = active_shift_ids[1] WHERE array_length(active_shift_ids, 1) > 0;

-- Drop the new column
ALTER TABLE workstations DROP COLUMN active_shift_ids;
