import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface WeekdayTime {
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface Shift {
  id: string;
  name: string;
  short_name: string;
  color: string;
  weekday_times: WeekdayTime[];
}

export interface CreateShiftRequest {
  name: string;
  short_name: string;
  color: string;
}

export interface UpdateShiftRequest {
  name?: string;
  short_name?: string;
  color?: string;
}

export interface SetWeekdayTimeRequest {
  weekday: number;
  start_time: string;
  end_time: string;
}

@Injectable({
  providedIn: 'root',
})
export class ShiftService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  getShifts(): Observable<Shift[]> {
    return this.http.get<Shift[]>(`${this.apiUrl}/shifts`);
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
    return this.http.patch<Shift>(`${this.apiUrl}/shifts/${shiftId}`, request);
  }
}
