import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PriorityWeights {
  high: number;
  medium: number;
  low: number;
}

/**
 * How each shift's and workstation's `min_employees` binds the solver:
 * `soft` prices a shortfall into the objective, `hard` forbids one — which can
 * leave a period with no plan at all rather than an understaffed one.
 */
export type MinStaffingMode = 'soft' | 'hard';

export interface PlannerSettings {
  night_shift_recovery_days: number;
  min_rest_hours: number;
  max_consecutive_days: number;
  max_working_days_per_week: number;
  equality_weight: number;
  priority_weights: PriorityWeights;
  monthly_hours_target_weight: number;
  solver_time_limit_seconds: number;
  solver_num_workers: number;
  updated_at: string;
  weekly_min_hours: number | null;
  weekly_max_hours: number | null;
  weekly_hours_target_weight: number;
  preference_weight: number;
  wish_weight: number;
  skill_downgrade_weight: number;
  fatigue_weight: number;
  night_shift_fatigue_multiplier: number;
  shift_continuity_weight: number;
  shift_continuity_week_bonus: number;
  min_staffing_mode: MinStaffingMode;
  /** Rotations and other fixed assignments: kept first (true) or ignored when planning. */
  keep_fixed_assignments: boolean;
  /** Employees' personal max nights / weekends per month: never exceeded (hard) or only to fill a slot (soft). */
  personal_limits_mode: MinStaffingMode;
  /** Weekly hours of every employee without their own value (40 unless changed). */
  default_weekly_working_hours: number;
  /** A draft month is due for publishing this many days before it starts (28). */
  publish_lead_days: number;
  /** A change to a published month within this many days from today needs a reason (7, 0 = off). */
  freeze_days: number;
  /** > 0: a re-plan keeps the published roster, changing as few days as it must; 0: off. */
  change_weight: number;
  /** Legal rule set held as hard rules: none, or ArbZG with JArbSchG and MuSchG. */
  labor_law_profile: LaborLawProfile;
  /** Reference period of the 48 h weekly average, in weeks (24). */
  labor_law_averaging_weeks: number;
  /**
   * The use case picked on the settings page, or null for custom settings. A
   * label only: the values are what the optimizer uses. Saved with them.
   */
  use_case: string | null;

  /** Automatic planning: the schedule runs the optimizer on its own. Off by default. */
  auto_plan_enabled: boolean;
  /** Runs every this many weeks (1–12), counted from the start date. */
  auto_plan_every_weeks: number;
  /** 0 = Monday … 6 = Sunday. */
  auto_plan_weekday: number;
  /** `HH:MM`, the server's local time. */
  auto_plan_time: string;
  /** `YYYY-MM-DD`; anchors the cycle. Required while the schedule is on. */
  auto_plan_start_date: string | null;
  /** With the count one of the eight offered ranges (2, 4, 6, 8, 12 weeks; 1, 2, 3 months). */
  auto_plan_range_unit: AutoPlanRangeUnit;
  auto_plan_range_count: number;

  /** Read-only, from the server: when the schedule runs next (local date-time). */
  auto_plan_next_run: string | null;
  /** Read-only, written by the job: the run day last started and what came of it. */
  auto_plan_last_run_on: string | null;
  auto_plan_last_outcome: AutoPlanOutcome | null;
  auto_plan_last_note: string | null;
  /** The planning run, to find it in the Scheduler's Runs tab. */
  auto_plan_last_task_id: string | null;
}

export type AutoPlanRangeUnit = 'weeks' | 'months';
export type AutoPlanOutcome = 'running' | 'taken_over' | 'kept_as_proposal' | 'skipped' | 'failed';

/** What the server computes and the job writes: never part of a save. */
export type AutoPlanStatusField =
  | 'auto_plan_next_run'
  | 'auto_plan_last_run_on'
  | 'auto_plan_last_outcome'
  | 'auto_plan_last_note'
  | 'auto_plan_last_task_id';

export type LaborLawProfile = 'none' | 'arbzg_de';

export type UpdatePlannerSettingsRequest = Omit<PlannerSettings, 'updated_at' | AutoPlanStatusField>;

@Injectable({
  providedIn: 'root',
})
export class PlannerSettingsService {
  private readonly apiUrl = '/api/v1/planner-settings';

  constructor(private http: HttpClient) {}

  getPlannerSettings(): Observable<PlannerSettings> {
    return this.http.get<PlannerSettings>(this.apiUrl);
  }

  updatePlannerSettings(settings: UpdatePlannerSettingsRequest): Observable<PlannerSettings> {
    return this.http.put<PlannerSettings>(this.apiUrl, settings);
  }
}
