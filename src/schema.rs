diesel::table! {
    capabilities (id) {
        id -> Uuid,
        name -> Varchar,
    }
}

diesel::table! {
    employee_available_shifts (employee_id, shift_id) {
        employee_id -> Uuid,
        shift_id -> Uuid,
    }
}

diesel::table! {
    employee_capabilities (employee_id, capability_id) {
        employee_id -> Uuid,
        capability_id -> Uuid,
    }
}

diesel::table! {
    employees (id) {
        id -> Uuid,
        name -> Varchar,
        email -> Varchar,
    }
}

diesel::table! {
    shifts (id) {
        id -> Uuid,
        name -> Varchar,
    }
}

diesel::table! {
    shift_weekday_times (id) {
        id -> Uuid,
        shift_id -> Uuid,
        weekday -> Int2,
        start_time -> Time,
        end_time -> Time,
    }
}

diesel::table! {
    workstations (id) {
        id -> Uuid,
        name -> Varchar,
        available -> Bool,
        active_shift_ids -> Array<Uuid>,
    }
}

diesel::table! {
    workstation_required_capabilities (workstation_id, capability_id) {
        workstation_id -> Uuid,
        capability_id -> Uuid,
    }
}

diesel::table! {
    unavailabilities (id) {
        id -> Uuid,
        employee_id -> Uuid,
        unavailable_date -> Date,
        shift_id -> Nullable<Uuid>,
    }
}

diesel::joinable!(employee_available_shifts -> employees (employee_id));
diesel::joinable!(employee_available_shifts -> shifts (shift_id));
diesel::joinable!(employee_capabilities -> capabilities (capability_id));
diesel::joinable!(employee_capabilities -> employees (employee_id));
diesel::joinable!(workstation_required_capabilities -> capabilities (capability_id));
diesel::joinable!(workstation_required_capabilities -> workstations (workstation_id));
diesel::joinable!(unavailabilities -> employees (employee_id));
diesel::joinable!(unavailabilities -> shifts (shift_id));
diesel::joinable!(shift_weekday_times -> shifts (shift_id));

diesel::allow_tables_to_appear_in_same_query!(
    capabilities,
    employee_available_shifts,
    employee_capabilities,
    employees,
    shifts,
    shift_weekday_times,
    workstations,
    workstation_required_capabilities,
    unavailabilities,
);