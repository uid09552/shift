ALTER TABLE confirmed_shift_plans
    DROP CONSTRAINT confirmed_shift_plans_employee_id_fkey,
    ADD CONSTRAINT confirmed_shift_plans_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    DROP CONSTRAINT confirmed_shift_plans_shift_id_fkey,
    ADD CONSTRAINT confirmed_shift_plans_shift_id_fkey
        FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    DROP CONSTRAINT confirmed_shift_plans_workstation_id_fkey,
    ADD CONSTRAINT confirmed_shift_plans_workstation_id_fkey
        FOREIGN KEY (workstation_id) REFERENCES workstations(id) ON DELETE SET NULL;
