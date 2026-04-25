-- Add email column to employees table
ALTER TABLE employees ADD COLUMN email VARCHAR(255) UNIQUE NOT NULL;