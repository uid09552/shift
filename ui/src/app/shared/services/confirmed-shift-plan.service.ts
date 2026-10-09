import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ConfirmedShiftPlan {
  id: string;
  employee_id: string;
  shift_id: string | null;
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
  /** null clears the shift — e.g. when the person is marked absent. */
  shift_id?: string | null;
  workstation_id?: string | null;
  is_present?: boolean;
  absence_type?: string;
  creation_type?: string;
}

export interface CreateConfirmedShiftPlanRequest {
  shift_id?: string | null;
  workstation_id?: string | null;
  date: string;
  is_present?: boolean;
  absence_type?: string;
  creation_type?: string;
}

/**
 * Marks a write as part of a short-notice replacement, so the change notices
 * the employees get say so (`X-Change-Source`). Every other write is "manual".
 */
export interface RosterWriteOptions {
  source?: 'replacement';
}

function sourceHeaders(options?: RosterWriteOptions): { headers?: HttpHeaders } {
  return options?.source ? { headers: new HttpHeaders({ 'X-Change-Source': options.source }) } : {};
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
    options?: RosterWriteOptions,
  ): Observable<ConfirmedShiftPlan> {
    return this.http.post<ConfirmedShiftPlan>(
      `${this.apiUrl}/employees/${employeeId}/confirmed-shift-plans`,
      request,
      sourceHeaders(options),
    );
  }

  updateConfirmedShiftPlan(
    planId: string,
    request: UpdateConfirmedShiftPlanRequest,
    options?: RosterWriteOptions,
  ): Observable<ConfirmedShiftPlan> {
    return this.http.put<ConfirmedShiftPlan>(
      `${this.apiUrl}/confirmed-shift-plans/${planId}`,
      request,
      sourceHeaders(options),
    );
  }

  deleteConfirmedShiftPlan(planId: string, options?: RosterWriteOptions): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(
      `${this.apiUrl}/confirmed-shift-plans/${planId}`,
      sourceHeaders(options),
    );
  }
}
