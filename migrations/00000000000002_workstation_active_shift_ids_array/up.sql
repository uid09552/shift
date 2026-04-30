-- Add new active_shift_ids column as UUID array
ALTER TABLE workstations ADD COLUMN active_shift_ids UUID[] NOT NULL DEFAULT '{}';

-- Migrate data: wrap existing active_shift_id into array if not null
UPDATE workstations SET active_shift_ids = ARRAY[active_shift_id] WHERE active_shift_id IS NOT NULL;

-- Drop the old column
ALTER TABLE workstations DROP COLUMN active_shift_id;
