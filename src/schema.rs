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
        monthly_working_hours -> Float8,
    }
}

diesel::table! {
    shifts (id) {
        id -> Uuid,
        name -> Varchar,
        short_name -> Varchar,
        color -> Varchar,
        order -> Int4,
    }
}

diesel::table! {
    shift_weekday_times (id) {
        id -> Uuid,
        shift_id -> Uuid,
        weekday -> Int2,
        start_time -> Time,
        end_time -> Time,
        min_employees -> Int2,
        max_employees -> Nullable<Int2>,
    }
}

diesel::table! {
    workstations (id) {
        id -> Uuid,
        name -> Varchar,
        available -> Bool,
        active_shift_ids -> Array<Uuid>,
        priority -> Varchar,
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

diesel::table! {
    employee_shift_assignments (id) {
        id -> Uuid,
        employee_id -> Uuid,
        shift_id -> Uuid,
        date -> Date,
    }
}

diesel::table! {
    confirmed_shift_plans (id) {
        id -> Uuid,
        employee_id -> Uuid,
        shift_id -> Nullable<Uuid>,
        workstation_id -> Nullable<Uuid>,
        date -> Date,
        is_present -> Bool,
        absence_type -> Nullable<Varchar>,
        creation_type -> Varchar,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    optimized_shift_results (id) {
        id -> Uuid,
        result -> Jsonb,
        creation_date -> Timestamptz,
    }
}

diesel::table! {
    planning_tasks (id) {
        id -> Uuid,
        status -> Varchar,
        payload -> Jsonb,
        result_id -> Nullable<Uuid>,
        error_message -> Nullable<Text>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::joinable!(planning_tasks -> optimized_shift_results (result_id));
diesel::joinable!(employee_available_shifts -> employees (employee_id));
diesel::joinable!(employee_available_shifts -> shifts (shift_id));
diesel::joinable!(employee_capabilities -> capabilities (capability_id));
diesel::joinable!(employee_capabilities -> employees (employee_id));
diesel::joinable!(workstation_required_capabilities -> capabilities (capability_id));
diesel::joinable!(workstation_required_capabilities -> workstations (workstation_id));
diesel::joinable!(unavailabilities -> employees (employee_id));
diesel::joinable!(unavailabilities -> shifts (shift_id));
diesel::joinable!(shift_weekday_times -> shifts (shift_id));
diesel::joinable!(employee_shift_assignments -> employees (employee_id));
diesel::joinable!(employee_shift_assignments -> shifts (shift_id));
diesel::joinable!(confirmed_shift_plans -> employees (employee_id));
diesel::joinable!(confirmed_shift_plans -> shifts (shift_id));
diesel::joinable!(confirmed_shift_plans -> workstations (workstation_id));

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
    employee_shift_assignments,
    confirmed_shift_plans,
    optimized_shift_results,
    planning_tasks,
);