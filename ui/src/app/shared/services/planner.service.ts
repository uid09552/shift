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

export interface DailyPlanEntry {
  date: string;
  status: 'assigned' | 'not_assigned';
  shift_id?: string;
  shift_name?: string;
  workstation_id?: string;
  workstation_name?: string;
}

export interface EmployeeDailyPlan {
  employee_id: string;
  employee_name: string;
  daily_plan: DailyPlanEntry[];
}

export interface TaskResultDto {
  status: string;
  objective_value: number;
  planning_period: PlanningPeriodResult;
  schedule: DaySchedule[];
  employee_plans: EmployeeDailyPlan[];
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

export interface PlanTaskResponse {
  task_id: string;
}

export interface PlanTaskStatusResponse {
  task_id: string;
  status: 'running' | 'completed' | 'failed';
  result_id?: string;
}

export interface PlanRequest {
  start_date?: string;
  end_date?: string;
  employee_ids?: string[];
  monthly_hours_target_weight?: number;
}

export interface PlanningTaskItem {
  id: string;
  status: 'scheduled' | 'done' | 'error';
  result_id?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface PlanningTasksResponse {
  tasks: PlanningTaskItem[];
  count: number;
}

@Injectable({
  providedIn: 'root',
})
export class PlannerService {
  private readonly apiUrl = '/api/v1/planner';

  constructor(private http: HttpClient) {}

  /**
   * POST /planner/plan
   * Triggers the scheduling optimizer asynchronously. Returns a task ID immediately.
   */
  triggerPlan(employeeIds?: string[], startDate?: string, endDate?: string, monthlyHoursWeight?: number): Observable<PlanTaskResponse> {
    const body: PlanRequest = {};
    if (employeeIds && employeeIds.length > 0) body.employee_ids = employeeIds;
    if (startDate) body.start_date = startDate;
    if (endDate) body.end_date = endDate;
    if (monthlyHoursWeight && monthlyHoursWeight > 0) body.monthly_hours_target_weight = monthlyHoursWeight;
    return this.http.post<PlanTaskResponse>(`${this.apiUrl}/plan`, body);
  }

  /**
   * GET /planner/plan/:taskId/status
   * Polls the status of an async optimization task.
   */
  getPlanStatus(taskId: string): Observable<PlanTaskStatusResponse> {
    return this.http.get<PlanTaskStatusResponse>(`${this.apiUrl}/plan/${taskId}/status`);
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

  /**
   * GET /planner/tasks
   * Lists all planning tasks from the database.
   */
  getPlanningTasks(): Observable<PlanningTasksResponse> {
    return this.http.get<PlanningTasksResponse>(`${this.apiUrl}/tasks`);
  }
}
