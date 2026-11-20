import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'revoked';

/** A day-by-day warning: how many people with a capability may be away, and the days that would exceed it. */
export interface LeaveWarning {
  kind: 'limit';
  capability_id: string;
  capability: string | null;
  max_absent: number;
  dates: string[];
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  note: string | null;
  status: LeaveStatus;
  decided_by: string | null;
  decision_comment: string | null;
  created_at: string;
  updated_at: string;
  /** Only while pending, on create and on a single read. */
  warnings?: LeaveWarning[];
}

export interface LeaveBlackout {
  id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_at: string;
}

export interface LeaveLimit {
  capability_id: string;
  max_absent: number;
}

export interface CreateLeave {
  employee_id: string;
  start_date: string;
  end_date: string;
  note?: string;
}

export interface LeaveFilter {
  status?: LeaveStatus[];
  employee_id?: string;
  from?: string;
  to?: string;
}

export type LeaveAction = 'approve' | 'reject' | 'revoke' | 'cancel';

/** The days of a request, inclusive. */
export function leaveDays(leave: Pick<LeaveRequest, 'start_date' | 'end_date'>): number {
  const [sy, sm, sd] = leave.start_date.split('-').map(Number);
  const [ey, em, ed] = leave.end_date.split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1;
}

/**
 * Leave requests: an employee asks for a date range off, a planner approves or
 * rejects it (approval writes the absences), blackout periods refuse a request
 * and per-capability limits only warn. Who may do what is enforced by the backend.
 */
@Injectable({ providedIn: 'root' })
export class LeaveService {
  private readonly apiUrl = '/api/v1/leave-requests';

  constructor(private http: HttpClient) {}

  /** Planners get the tenant's requests; everyone else only their own. */
  list(filter: LeaveFilter = {}): Observable<LeaveRequest[]> {
    let params = new HttpParams();
    if (filter.status?.length) params = params.set('status', filter.status.join(','));
    if (filter.employee_id) params = params.set('employee_id', filter.employee_id);
    if (filter.from) params = params.set('from', filter.from);
    if (filter.to) params = params.set('to', filter.to);
    return this.http.get<LeaveRequest[]>(this.apiUrl, { params });
  }

  /** One request, with limit warnings while it is pending. */
  get(id: string): Observable<LeaveRequest> {
    return this.http.get<LeaveRequest>(`${this.apiUrl}/${id}`);
  }

  /** How many await a decision. Planners and admins only. */
  pendingCount(): Observable<number> {
    return this.http.get<{ count: number }>(`${this.apiUrl}/pending-count`).pipe(map((r) => r.count));
  }

  create(body: CreateLeave): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(this.apiUrl, body);
  }

  act(id: string, action: LeaveAction, comment?: string): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(`${this.apiUrl}/${id}/${action}`, comment ? { comment } : {});
  }

  listBlackouts(): Observable<LeaveBlackout[]> {
    return this.http.get<LeaveBlackout[]>('/api/v1/leave-blackouts');
  }

  createBlackout(body: { start_date: string; end_date: string; reason?: string }): Observable<LeaveBlackout> {
    return this.http.post<LeaveBlackout>('/api/v1/leave-blackouts', body);
  }

  deleteBlackout(id: string): Observable<unknown> {
    return this.http.delete(`/api/v1/leave-blackouts/${id}`);
  }

  /** Planners and admins only. */
  listLimits(): Observable<LeaveLimit[]> {
    return this.http.get<LeaveLimit[]>('/api/v1/leave-limits');
  }

  /** Replaces every limit. */
  saveLimits(limits: LeaveLimit[]): Observable<LeaveLimit[]> {
    return this.http.put<LeaveLimit[]>('/api/v1/leave-limits', { limits });
  }
}
