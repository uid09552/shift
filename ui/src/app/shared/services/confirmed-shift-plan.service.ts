import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ConfirmedShiftPlan {
  id: string;
  employee_id: string;
  shift_id: string;
  workstation_id: string | null;
  date: string;
  is_present: boolean;
  absence_type: string | null;
  creation_type: string;
  created_at: string;
  updated_at: string;
}

export interface PaginatedConfirmedShiftPlanResponse {
  data: ConfirmedShiftPlan[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpdateConfirmedShiftPlanRequest {
  shift_id?: string;
  workstation_id?: string | null;
  is_present?: boolean;
  absence_type?: string;
  creation_type?: string;
}

export interface CreateConfirmedShiftPlanRequest {
  shift_id: string;
  workstation_id?: string | null;
  date: string;
  is_present?: boolean;
  absence_type?: string;
  creation_type?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ConfirmedShiftPlanService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  getConfirmedShiftPlans(
    fromDate?: string,
    toDate?: string,
    limit?: number,
    offset?: number,
  ): Observable<PaginatedConfirmedShiftPlanResponse> {
    let params = new HttpParams();
    if (fromDate) params = params.set('from_date', fromDate);
    if (toDate) params = params.set('to_date', toDate);
    if (limit !== undefined) params = params.set('limit', limit);
    if (offset !== undefined) params = params.set('offset', offset);
    return this.http.get<PaginatedConfirmedShiftPlanResponse>(
      `${this.apiUrl}/confirmed-shift-plans`,
      { params },
    );
  }

  getEmployeeConfirmedShiftPlans(
    employeeId: string,
    fromDate?: string,
    toDate?: string,
  ): Observable<ConfirmedShiftPlan[]> {
    let params = new HttpParams();
    if (fromDate) params = params.set('from_date', fromDate);
    if (toDate) params = params.set('to_date', toDate);
    return this.http.get<ConfirmedShiftPlan[]>(
      `${this.apiUrl}/employees/${employeeId}/confirmed-shift-plans`,
      { params },
    );
  }

  createConfirmedShiftPlan(
    employeeId: string,
    request: CreateConfirmedShiftPlanRequest,
  ): Observable<ConfirmedShiftPlan> {
    return this.http.post<ConfirmedShiftPlan>(
      `${this.apiUrl}/employees/${employeeId}/confirmed-shift-plans`,
      request,
    );
  }

  updateConfirmedShiftPlan(
    planId: string,
    request: UpdateConfirmedShiftPlanRequest,
  ): Observable<ConfirmedShiftPlan> {
    return this.http.put<ConfirmedShiftPlan>(
      `${this.apiUrl}/confirmed-shift-plans/${planId}`,
      request,
    );
  }

  deleteConfirmedShiftPlan(planId: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(
      `${this.apiUrl}/confirmed-shift-plans/${planId}`,
    );
  }
}
