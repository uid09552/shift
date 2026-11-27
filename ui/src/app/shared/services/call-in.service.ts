import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Minutes someone on call from home was actually called in, recorded afterwards. */
export interface CallIn {
  employee_id: string;
  date: string;
  minutes: number;
  note: string | null;
  recorded_by: string | null;
}

@Injectable({ providedIn: 'root' })
export class CallInService {
  private readonly apiUrl = '/api/v1/call-ins';

  constructor(private http: HttpClient) {}

  list(from: string, to: string): Observable<CallIn[]> {
    return this.http.get<CallIn[]>(this.apiUrl, { params: { from_date: from, to_date: to } });
  }

  /** On an on-call duty only; replaces what was recorded for that day. */
  record(employeeId: string, date: string, minutes: number, note?: string): Observable<CallIn> {
    return this.http.put<CallIn>(this.apiUrl, { employee_id: employeeId, date, minutes, note: note || null });
  }

  remove(employeeId: string, date: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/${employeeId}/${date}`);
  }
}
