import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface WorkstationDailyHours {
  date: string;
  workstation_id: string;
  workstation_name: string;
  planned_hours: number;
}

export interface WorkstationDailyEmployees {
  date: string;
  workstation_id: string;
  workstation_name: string;
  planned_employees: number;
}

@Injectable({
  providedIn: 'root',
})
export class AnalysisService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  getPlannedHoursPerDayPerWorkstation(
    fromDate: string,
    toDate: string,
  ): Observable<WorkstationDailyHours[]> {
    const params = new HttpParams()
      .set('from_date', fromDate)
      .set('to_date', toDate);
    return this.http.get<WorkstationDailyHours[]>(
      `${this.apiUrl}/analysis/planned-hours-per-day-per-workstation`,
      { params },
    );
  }

  getPlannedEmployeesPerDayPerWorkstation(
    fromDate: string,
    toDate: string,
  ): Observable<WorkstationDailyEmployees[]> {
    const params = new HttpParams()
      .set('from_date', fromDate)
      .set('to_date', toDate);
    return this.http.get<WorkstationDailyEmployees[]>(
      `${this.apiUrl}/analysis/planned-employees-per-day-per-workstation`,
      { params },
    );
  }
}
