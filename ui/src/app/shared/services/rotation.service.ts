import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/** A named rhythm: one slot per day of the cycle, a shift id or null for a day off. */
export interface RotationPattern {
  id: string;
  name: string;
  slots: (string | null)[];
  created_at: string;
  updated_at: string;
}

/** A fixed assignment: this shift on this day, or with no shift, a fixed day off. */
export interface FixedAssignment {
  id: string;
  employee_id: string;
  shift_id: string | null;
  date: string;
}

export type ApplyCellStatus = 'new' | 'same' | 'replace' | 'conflict' | 'absent';

export interface ApplyCell {
  date: string;
  shift_id: string | null;
  status: ApplyCellStatus;
  /** What is already fixed on this day; null when nothing is. */
  existing: { shift_id: string | null } | null;
}

export interface ApplyRow {
  employee_id: string;
  employee_name: string;
  offset: number;
  cells: ApplyCell[];
}

export interface ApplyResult {
  dry_run: boolean;
  pattern_id: string;
  cycle_length: number;
  from_date: string;
  to_date: string;
  summary: { written: number; replaced: number; unchanged: number; conflicts: number; on_absence: number };
  rows: ApplyRow[];
}

export interface ApplyRequest {
  employee_ids: string[];
  start_date: string;
  end_date: string;
  /** Days each next person starts later in the cycle. */
  offset_step: number;
  replace_existing: boolean;
  dry_run: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class RotationService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  listPatterns(): Observable<RotationPattern[]> {
    return this.http.get<RotationPattern[]>(`${this.apiUrl}/rotation-patterns`);
  }

  createPattern(name: string, slots: (string | null)[]): Observable<RotationPattern> {
    return this.http.post<RotationPattern>(`${this.apiUrl}/rotation-patterns`, { name, slots });
  }

  updatePattern(id: string, name: string, slots: (string | null)[]): Observable<RotationPattern> {
    return this.http.put<RotationPattern>(`${this.apiUrl}/rotation-patterns/${id}`, { name, slots });
  }

  deletePattern(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/rotation-patterns/${id}`);
  }

  /** With `dry_run` this is the preview: the grid that would be written, nothing written. */
  apply(patternId: string, request: ApplyRequest): Observable<ApplyResult> {
    return this.http.post<ApplyResult>(`${this.apiUrl}/rotation-patterns/${patternId}/apply`, request);
  }

  listFixed(fromDate: string, toDate: string, employeeIds?: string[]): Observable<FixedAssignment[]> {
    let params = new HttpParams().set('from_date', fromDate).set('to_date', toDate);
    if (employeeIds?.length) params = params.set('employee_ids', employeeIds.join(','));
    return this.http.get<FixedAssignment[]>(`${this.apiUrl}/shift-assignments`, { params });
  }

  /** Removes these people's fixed assignments in the range. */
  clearFixed(employeeIds: string[], fromDate: string, toDate: string): Observable<{ deleted: number }> {
    return this.http.post<{ deleted: number }>(`${this.apiUrl}/shift-assignments/clear`, {
      employee_ids: employeeIds,
      from_date: fromDate,
      to_date: toDate,
    });
  }
}
