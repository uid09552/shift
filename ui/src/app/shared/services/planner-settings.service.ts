import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PriorityWeights {
  high: number;
  medium: number;
  low: number;
}

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
}

export type UpdatePlannerSettingsRequest = Omit<PlannerSettings, 'updated_at'>;

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
