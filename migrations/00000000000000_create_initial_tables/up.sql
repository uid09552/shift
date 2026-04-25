-- Create employees table
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL
);

-- Create shifts table (typical shifts)
CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE
);

-- Create employee_available_shifts table (many-to-many)
CREATE TABLE employee_available_shifts (
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    PRIMARY KEY (employee_id, shift_id)
);

-- Create capabilities table
CREATE TABLE capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE
);

-- Create employee_capabilities table (many-to-many)
CREATE TABLE employee_capabilities (
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    capability_id UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    PRIMARY KEY (employee_id, capability_id)
);

-- Create unavailabilities table (days/shifts not available)
CREATE TABLE unavailabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    unavailable_date DATE NOT NULL,
    shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,  -- NULL means whole day unavailable
    UNIQUE (employee_id, unavailable_date, shift_id)
);