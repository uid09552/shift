import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export type ShiftSwapStatus =
  | 'pending_colleague'
  | 'pending_planner'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'stale';

/** One person's shift as it stood in the confirmed roster when the request was made. */
export interface ShiftSwapSide {
  employee_id: string;
  date: string;
  shift_id: string;
  workstation_id: string | null;
}

export interface ShiftSwap {
  id: string;
  requester: ShiftSwapSide;
  colleague: ShiftSwapSide;
  status: ShiftSwapStatus;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

/** For one of the two people: the shift they would take and the rules it breaks. */
export interface ShiftSwapWarning {
  employee_id: string;
  name: string;
  date: string;
  takes: string | null;
  violations: string[];
}

/** A request as a planner reviews it: with the rule warnings, or why there are none. */
export interface ShiftSwapDetail extends ShiftSwap {
  warnings?: ShiftSwapWarning[];
  warnings_error?: string;
}

export interface CreateShiftSwap {
  requester_id: string;
  requester_date: string;
  colleague_id: string;
  colleague_date: string;
}

export type ShiftSwapAction = 'accept' | 'decline' | 'cancel' | 'approve' | 'reject';

/**
 * Shift swaps: an employee offers their confirmed shift for a colleague's, the
 * colleague accepts or declines, a planner approves (the roster rows are
 * exchanged) or rejects. Who may do what is enforced by the backend.
 */
@Injectable({ providedIn: 'root' })
export class ShiftSwapService {
  private readonly apiUrl = '/api/v1/shift-swaps';

  constructor(private http: HttpClient) {}

  /** Planners get the tenant's requests; everyone else only their own. */
  list(status?: ShiftSwapStatus): Observable<ShiftSwap[]> {
    const params = status ? new HttpParams().set('status', status) : undefined;
    return this.http.get<ShiftSwap[]>(this.apiUrl, { params });
  }

  get(id: string): Observable<ShiftSwapDetail> {
    return this.http.get<ShiftSwapDetail>(`${this.apiUrl}/${id}`);
  }

  /** How many await a planner's decision. Planners and admins only. */
  pendingCount(): Observable<number> {
    return this.http.get<{ count: number }>(`${this.apiUrl}/pending-count`).pipe(map((r) => r.count));
  }

  create(body: CreateShiftSwap): Observable<ShiftSwap> {
    return this.http.post<ShiftSwap>(this.apiUrl, body);
  }

  act(id: string, action: ShiftSwapAction): Observable<ShiftSwap> {
    return this.http.post<ShiftSwap>(`${this.apiUrl}/${id}/${action}`, {});
  }
}
