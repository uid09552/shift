import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

// ── DTOs matching backend TaskResultDto ───────────────────────────────────────

export interface PlanningPeriodResult {
  start_date: string;
  end_date: string;
}

export interface ShiftAssignment {
  date: string;
  employee_id: string;
  employee_name: string;
  workstation_id: string;
  workstation_name: string;
}

export interface ShiftSchedule {
  shift_id: string;
  shift_name: string;
  assigned_dates: ShiftAssignment[];
}

export interface DaySchedule {
  date: string;
  weekday: string;
  shifts: ShiftSchedule[];
}

export interface EmployeeShiftSummary {
  shift_id: string;
  shift_name: string;
  total_assignments: number;
  assigned_dates: string[];
}

export interface EmployeeSummary {
  employee_id: string;
  employee_name: string;
  total_shifts: number;
  night_shifts: number;
  total_working_hours: number;
  per_shift: EmployeeShiftSummary[];
  assigned_dates: string[];
}

export interface TaskResultDto {
  status: string;
  objective_value: number;
  planning_period: PlanningPeriodResult;
  schedule: DaySchedule[];
  employee_summary: EmployeeSummary[];
  message?: string;
}

// ── API Response types ───────────────────────────────────────────────────────

export interface OptimizedShiftResultResponse {
  id: string;
  result: TaskResultDto;
  creation_date: string;
}

export interface PaginatedOptimizedShiftResultsResponse {
  data: OptimizedShiftResultResponse[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable({
  providedIn: 'root',
})
export class PlannerService {
  private readonly apiUrl = '/api/v1/planner';

  constructor(private http: HttpClient) {}

  /**
   * POST /planner/plan
   * Triggers the scheduling optimizer to calculate a new optimized plan.
   */
  triggerPlan(): Observable<OptimizedShiftResultResponse> {
    return this.http.post<OptimizedShiftResultResponse>(`${this.apiUrl}/plan`, {});
  }

  /**
   * GET /planner/optimized-shifts
   * Lists all stored optimized shift results.
   * Use latest=true to get only the most recent result.
   */
  getOptimizedShifts(
    limit?: number,
    offset?: number,
    latest?: boolean
  ): Observable<PaginatedOptimizedShiftResultsResponse> {
    let params = new HttpParams();
    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }
    if (offset !== undefined) {
      params = params.set('offset', offset.toString());
    }
    if (latest !== undefined) {
      params = params.set('latest', latest.toString());
    }
    return this.http.get<PaginatedOptimizedShiftResultsResponse>(
      `${this.apiUrl}/optimized-shifts`,
      { params }
    );
  }

  /**
   * GET /planner/optimized-shifts/:result_id
   * Gets a specific optimized shift result by ID.
   */
  getOptimizedShift(resultId: string): Observable<OptimizedShiftResultResponse> {
    return this.http.get<OptimizedShiftResultResponse>(
      `${this.apiUrl}/optimized-shifts/${resultId}`
    );
  }

  /**
   * DELETE /planner/optimized-shifts/:result_id
   * Deletes a specific optimized shift result.
   */
  deleteOptimizedShift(resultId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/optimized-shifts/${resultId}`);
  }
}
