import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export type OpenShiftStatus = 'open' | 'filled' | 'closed';

/** A volunteer as a planner sees them, with whether they may still take the slot. */
export interface OpenShiftVolunteer {
  employee_id: string;
  created_at: string;
  eligible: boolean;
  reasons: string[];
}

export interface OpenShift {
  id: string;
  date: string;
  shift_id: string;
  workstation_id: string | null;
  note: string | null;
  status: OpenShiftStatus;
  assigned_employee_id: string | null;
  created_by: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
  volunteer_count?: number;
  /** For an employee: whether they may take it, why not, and whether they have volunteered. */
  eligible?: boolean;
  reasons?: string[];
  volunteered?: boolean;
  /** For a planner. */
  volunteers?: OpenShiftVolunteer[];
}

/** A slot of the confirmed roster below its workstation's minimum. */
export interface OpenShiftGap {
  date: string;
  shift_id: string;
  workstation_id: string;
  short: number;
  min_employees: number;
}

export interface CreateOpenShift {
  date: string;
  shift_id: string;
  workstation_id?: string | null;
  note?: string;
}

/**
 * Open shifts: a planner offers a slot nobody is planned on, qualified
 * employees volunteer, a planner assigns one — which writes the roster. Who may
 * take a slot, and why not, is decided by the backend.
 */
@Injectable({ providedIn: 'root' })
export class OpenShiftService {
  private readonly apiUrl = '/api/v1/open-shifts';

  constructor(private http: HttpClient) {}

  /** Open offers from today on unless `status` says otherwise. */
  list(status?: OpenShiftStatus[]): Observable<OpenShift[]> {
    const params = status?.length ? new HttpParams().set('status', status.join(',')) : undefined;
    return this.http.get<OpenShift[]>(this.apiUrl, { params });
  }

  /** How many offers are open from today on. */
  count(): Observable<number> {
    return this.http.get<{ count: number }>(`${this.apiUrl}/count`).pipe(map((r) => r.count));
  }

  /** Planners only: slots below their minimum that nobody has offered yet. */
  gaps(from: string, to: string): Observable<OpenShiftGap[]> {
    return this.http.get<OpenShiftGap[]>(`${this.apiUrl}/gaps`, { params: new HttpParams().set('from', from).set('to', to) });
  }

  create(body: CreateOpenShift): Observable<OpenShift> {
    return this.http.post<OpenShift>(this.apiUrl, body);
  }

  volunteer(id: string): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/${id}/volunteer`, {});
  }

  withdraw(id: string): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/${id}/withdraw`, {});
  }

  assign(id: string, employeeId: string): Observable<OpenShift> {
    return this.http.post<OpenShift>(`${this.apiUrl}/${id}/assign`, { employee_id: employeeId });
  }

  close(id: string): Observable<OpenShift> {
    return this.http.post<OpenShift>(`${this.apiUrl}/${id}/close`, {});
  }
}
