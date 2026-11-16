-- Deleting an employee, a shift or a workstation must not change the roster
-- behind the roster guard's back (issue #146): the backend refuses while a
-- published or locked month uses the item and clears draft entries itself, in
-- the same transaction. The database now refuses anything left over.
ALTER TABLE confirmed_shift_plans
    DROP CONSTRAINT confirmed_shift_plans_employee_id_fkey,
    ADD CONSTRAINT confirmed_shift_plans_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    DROP CONSTRAINT confirmed_shift_plans_shift_id_fkey,
    ADD CONSTRAINT confirmed_shift_plans_shift_id_fkey
        FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT,
    DROP CONSTRAINT confirmed_shift_plans_workstation_id_fkey,
    ADD CONSTRAINT confirmed_shift_plans_workstation_id_fkey
        FOREIGN KEY (workstation_id) REFERENCES workstations(id) ON DELETE RESTRICT;
