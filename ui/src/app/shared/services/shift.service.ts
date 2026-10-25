import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ImportColumnMapping, ImportPreview, importFormData } from '../components/import-dialog/import.models';

export interface WeekdayTime {
  weekday: number;
  start_time: string;
  end_time: string;
  min_employees: number;
  max_employees: number | null;
  free_days_after_shift: number;
}

export interface Shift {
  id: string;
  name: string;
  short_name: string;
  color: string;
  order: number;
  /** Unpaid break inside the shift, in minutes; its hours are counted net of it. */
  break_minutes?: number;
  weekday_times: WeekdayTime[];
}

export interface CreateShiftRequest {
  name: string;
  short_name: string;
  color: string;
  order?: number;
  break_minutes?: number;
}

export interface UpdateShiftRequest {
  name?: string;
  short_name?: string;
  color?: string;
  order?: number;
  break_minutes?: number;
}

export interface SetWeekdayTimeRequest {
  weekday: number;
  start_time: string;
  end_time: string;
  min_employees?: number;
  max_employees?: number | null;
  free_days_after_shift?: number;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

@Injectable({
  providedIn: 'root',
})
export class ShiftService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  getShifts(): Observable<Shift[]> {
    return this.http.get<Shift[]>(`${this.apiUrl}/shifts`).pipe(
      map(shifts => shifts.sort((a, b) => a.order - b.order))
    );
  }

  getShiftById(shiftId: string): Observable<Shift> {
    return this.http.get<Shift>(`${this.apiUrl}/shifts/${shiftId}`);
  }

  createShift(request: CreateShiftRequest): Observable<Shift> {
    return this.http.post<Shift>(`${this.apiUrl}/shifts`, request);
  }

  setWeekdayTime(shiftId: string, request: SetWeekdayTimeRequest): Observable<WeekdayTime> {
    return this.http.post<WeekdayTime>(`${this.apiUrl}/shifts/${shiftId}/weekday-times`, request);
  }

  deleteWeekdayTime(shiftId: string, weekday: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/shifts/${shiftId}/weekday-times/${weekday}`);
  }

  updateShift(shiftId: string, request: UpdateShiftRequest): Observable<Shift> {
    return this.http.put<Shift>(`${this.apiUrl}/shifts/${shiftId}`, request);
  }

  deleteShift(shiftId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/shifts/${shiftId}`);
  }

  downloadTemplate(): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/shifts/template`, { responseType: 'blob' });
  }

  /** How `file` would be read, nothing written. `sheet` picks another sheet of the workbook. */
  previewImport(file: File, sheet?: string): Observable<ImportPreview> {
    return this.http.post<ImportPreview>(`${this.apiUrl}/shifts/import/preview`, importFormData(file, { sheet }));
  }

  /** Imports `file`; `mapping` is what the user assigned, detection is used without it. */
  importFromFile(file: File, mapping?: ImportColumnMapping): Observable<ImportResult> {
    const parts = { mapping: mapping && JSON.stringify(mapping) };
    return this.http.post<ImportResult>(`${this.apiUrl}/shifts/import`, importFormData(file, parts));
  }
}
