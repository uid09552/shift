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
  /** 'unassigned' is a client-side edit state (no shift, not marked free) — the backend stores it as an opaque string. */
  status: 'assigned' | 'free' | 'unassigned';
  shift_id?: string | null;
  shift_name?: string | null;
  workstation_id?: string | null;
  workstation_name?: string | null;
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

// ── The solver's input, as POST /planner/prepare builds it ────────────────────
// Weekdays are strings "0" (Monday) … "6"; skills and required_skills are
// capability names, and so is a capability's `id` here.

export interface PreparedWeekdayTime {
  weekday: string;
  start_time: string;
  end_time: string;
  min_employees: number;
  max_employees?: number | null;
}

export interface PreparedShift {
  id: string;
  name: string;
  is_night_shift: boolean;
  weekday_times: PreparedWeekdayTime[];
}

export interface PreparedWorkstation {
  id: string;
  name: string;
  required_skills: string[];
  priority: string;
  operating_shifts: string[];
  min_employees: number;
  max_employees?: number | null;
  unavailability: { from_date: string; to_date: string }[];
}

export interface PreparedEmployee {
  id: string;
  name: string;
  skills: string[];
  available_shifts: string[];
  /** Hard absences, YYYY-MM-DD. */
  unavailability: string[];
}

export interface PreparedPlan {
  planning_period: PlanningPeriodResult;
  shifts: PreparedShift[];
  workstations: PreparedWorkstation[];
  employees: PreparedEmployee[];
  capabilities?: { id: string; level?: number; skill_group?: string | null }[];
  constraints?: { max_working_days_per_week?: number | null } | null;
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

export interface TakeAsPlanResponse {
  employee_count: number;
  created: number;
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
   * POST /planner/prepare
   * The exact input a plan would be calculated from, without calculating it.
   */
  preparePlan(employeeIds?: string[], startDate?: string, endDate?: string): Observable<PreparedPlan> {
    const body: PlanRequest = {};
    if (employeeIds && employeeIds.length > 0) body.employee_ids = employeeIds;
    if (startDate) body.start_date = startDate;
    if (endDate) body.end_date = endDate;
    return this.http.post<PreparedPlan>(`${this.apiUrl}/prepare`, body);
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
   * PUT /planner/optimized-shifts/:result_id
   * Overwrites the stored proposed schedule (used to persist manual edits made in the scheduler UI).
   */
  updateOptimizedShift(resultId: string, result: TaskResultDto): Observable<OptimizedShiftResultResponse> {
    return this.http.put<OptimizedShiftResultResponse>(`${this.apiUrl}/optimized-shifts/${resultId}`, result);
  }

  /**
   * DELETE /planner/optimized-shifts/:result_id
   * Deletes a specific optimized shift result.
   */
  deleteOptimizedShift(resultId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/optimized-shifts/${resultId}`);
  }

  /**
   * POST /planner/optimized-shifts/:result_id/take-as-plan
   * Overwrites the confirmed shift plans for the result's planning period (optionally scoped
   * to a subset of employees) with this result's assignments/free days. Runs entirely
   * server-side in one transaction — no per-employee/per-entry API calls needed from the UI.
   */
  takeAsPlan(resultId: string, employeeIds?: string[]): Observable<TakeAsPlanResponse> {
    const body: { employee_ids?: string[] } = {};
    if (employeeIds && employeeIds.length) body.employee_ids = employeeIds;
    return this.http.post<TakeAsPlanResponse>(`${this.apiUrl}/optimized-shifts/${resultId}/take-as-plan`, body);
  }

  /**
   * GET /planner/tasks
   * Lists all planning tasks from the database.
   */
  getPlanningTasks(): Observable<PlanningTasksResponse> {
    return this.http.get<PlanningTasksResponse>(`${this.apiUrl}/tasks`);
  }

  /**
   * DELETE /planner/tasks/:task_id
   * Deletes a planning task (e.g. failed jobs).
   */
  deletePlanningTask(taskId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/tasks/${taskId}`);
  }
}
