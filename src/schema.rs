diesel::table! {
    capabilities (id) {
        id -> Uuid,
        name -> Varchar,
        tenant_id -> Varchar,
        level -> Int2,
        skill_group -> Nullable<Varchar>,
    }
}

diesel::table! {
    employee_available_shifts (employee_id, shift_id) {
        employee_id -> Uuid,
        shift_id -> Uuid,
        tenant_id -> Varchar,
    }
}

diesel::table! {
    employee_capabilities (employee_id, capability_id) {
        employee_id -> Uuid,
        capability_id -> Uuid,
        tenant_id -> Varchar,
    }
}

diesel::table! {
    employees (id) {
        id -> Uuid,
        name -> Varchar,
        email -> Varchar,
        monthly_working_hours -> Float8,
        tenant_id -> Varchar,
    }
}

diesel::table! {
    shifts (id) {
        id -> Uuid,
        name -> Varchar,
        short_name -> Varchar,
        color -> Varchar,
        order -> Int4,
        tenant_id -> Varchar,
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
        free_days_after_shift -> Int2,
        tenant_id -> Varchar,
    }
}

diesel::table! {
    workstations (id) {
        id -> Uuid,
        name -> Varchar,
        available -> Bool,
        active_shift_ids -> Array<Uuid>,
        priority -> Varchar,
        min_employees -> Int2,
        max_employees -> Nullable<Int2>,
        tenant_id -> Varchar,
    }
}

diesel::table! {
    workstation_unavailabilities (id) {
        id -> Uuid,
        workstation_id -> Uuid,
        unavailable_from -> Date,
        unavailable_to -> Date,
        tenant_id -> Varchar,
    }
}

diesel::table! {
    workstation_required_capabilities (workstation_id, capability_id) {
        workstation_id -> Uuid,
        capability_id -> Uuid,
        tenant_id -> Varchar,
    }
}

diesel::table! {
    unavailabilities (id) {
        id -> Uuid,
        employee_id -> Uuid,
        unavailable_date -> Date,
        shift_id -> Nullable<Uuid>,
        tenant_id -> Varchar,
        is_soft_preference -> Bool,
    }
}

diesel::table! {
    shift_wishes (id) {
        id -> Uuid,
        employee_id -> Uuid,
        shift_id -> Uuid,
        wish_date -> Date,
        tenant_id -> Varchar,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    employee_shift_assignments (id) {
        id -> Uuid,
        employee_id -> Uuid,
        shift_id -> Uuid,
        date -> Date,
        tenant_id -> Varchar,
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
        tenant_id -> Varchar,
    }
}

diesel::table! {
    optimized_shift_results (id) {
        id -> Uuid,
        result -> Jsonb,
        creation_date -> Timestamptz,
        tenant_id -> Varchar,
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
        tenant_id -> Varchar,
    }
}

diesel::table! {
    planner_settings (tenant_id) {
        tenant_id -> Varchar,
        night_shift_recovery_days -> Int2,
        min_rest_hours -> Float8,
        max_consecutive_days -> Int2,
        max_working_days_per_week -> Int2,
        equality_weight -> Int4,
        priority_weight_high -> Int4,
        priority_weight_medium -> Int4,
        priority_weight_low -> Int4,
        monthly_hours_target_weight -> Int4,
        solver_time_limit_seconds -> Float8,
        solver_num_workers -> Int2,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        weekly_min_hours -> Nullable<Float8>,
        weekly_max_hours -> Nullable<Float8>,
        weekly_hours_target_weight -> Int4,
        preference_weight -> Int4,
        skill_downgrade_weight -> Int4,
        fatigue_weight -> Int4,
        night_shift_fatigue_multiplier -> Float8,
        shift_continuity_weight -> Int4,
        shift_continuity_week_bonus -> Int4,
        wish_weight -> Int4,
        min_staffing_mode -> Varchar,
    }
}

diesel::table! {
    wish_settings (tenant_id) {
        tenant_id -> Varchar,
        mode -> Varchar,
        window_start -> Nullable<Date>,
        window_end -> Nullable<Date>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    audit_logs (id) {
        id -> Uuid,
        tenant_id -> Varchar,
        actor -> Nullable<Varchar>,
        action -> Varchar,
        entity_type -> Nullable<Varchar>,
        entity_id -> Nullable<Varchar>,
        changes -> Nullable<Text>,
        created_at -> Timestamptz,
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
diesel::joinable!(shift_wishes -> employees (employee_id));
diesel::joinable!(shift_wishes -> shifts (shift_id));
diesel::joinable!(shift_weekday_times -> shifts (shift_id));
diesel::joinable!(workstation_unavailabilities -> workstations (workstation_id));
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
    shift_wishes,
    employee_shift_assignments,
    confirmed_shift_plans,
    optimized_shift_results,
    planning_tasks,
    workstation_unavailabilities,
    audit_logs,
    planner_settings,
    wish_settings,
);