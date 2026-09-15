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

/** One person working on a given day, with shift and workstation already named. */
export interface WorkingEmployee {
  employee_id: string;
  employee_name: string;
  shift_id: string | null;
  shift_name: string | null;
  workstation_id: string | null;
  workstation_name: string | null;
}

export interface ShiftDailyStaffing {
  shift_id: string;
  shift_name: string;
  employees_working: number;
}

export interface DailyStaffing {
  date: string;
  employees_working: number;
  employees: WorkingEmployee[];
  per_shift: ShiftDailyStaffing[];
}

/** One person's share of the confirmed roster over a period. */
export interface EmployeeFairness {
  employee_id: string;
  employee_name: string;
  shifts: number;
  hours: number;
  /** Monthly target scaled to the period; null without a target. */
  target_hours: number | null;
  night_shifts: number;
  weekend_days: number;
  weekends: number;
  wishes_asked: number;
  wishes_granted: number;
  /** Sick, leave or holiday — not a plain day off. */
  days_absent: number;
}

export interface FairnessReport {
  from_date: string;
  to_date: string;
  days: number;
  employees: EmployeeFairness[];
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

  /**
   * Who works on each day of the range and how many, with shift and workstation
   * names resolved server-side — one call instead of a roster plus three lookup
   * lists. Unlike the per-workstation counts above, this covers people rostered
   * without a workstation too.
   */
  getStaffingPerDay(fromDate: string, toDate: string): Observable<DailyStaffing[]> {
    const params = new HttpParams()
      .set('from_date', fromDate)
      .set('to_date', toDate);
    return this.http.get<DailyStaffing[]>(`${this.apiUrl}/analysis/staffing-per-day`, {
      params,
    });
  }

  /** Each employee's share of the confirmed roster over the range — nights, weekends, hours, wishes. */
  getFairness(fromDate: string, toDate: string): Observable<FairnessReport> {
    const params = new HttpParams()
      .set('from_date', fromDate)
      .set('to_date', toDate);
    return this.http.get<FairnessReport>(`${this.apiUrl}/analysis/fairness`, { params });
  }
}
