-- Initialize databases for Kratos and Hydra
-- Create users first
CREATE USER kratos WITH PASSWORD 'kratos';
CREATE USER hydra WITH PASSWORD 'hydra';

-- Create databases with the correct owner
CREATE DATABASE kratos OWNER kratos;
CREATE DATABASE hydra OWNER hydra;

-- Grant schema permissions for Hydra
GRANT ALL ON SCHEMA public TO hydra;
GRANT ALL PRIVILEGES ON DATABASE hydra TO hydra;

-- Grant schema permissions for Kratos
GRANT ALL ON SCHEMA public TO kratos;
GRANT ALL PRIVILEGES ON DATABASE kratos TO kratos;
