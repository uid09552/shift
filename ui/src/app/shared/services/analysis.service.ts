import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

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

/** `GET /analysis/roster-facts` as sent: dimensions plus parallel columns. */
export interface RosterFactsPayload {
  from_date: string;
  to_date: string;
  dims: {
    employees: { id: string; name: string; capabilities: string[]; weekly_hours: number }[];
    capabilities: { id: string; name: string }[];
    shifts: {
      id: string;
      name: string;
      short_name: string;
      color: string;
      is_night: boolean;
      /** Weekday 0 = Monday … 6 = Sunday; public holidays use 6. */
      weekday: { weekday: number; min: number; max: number | null }[];
    }[];
    workstations: {
      id: string;
      name: string;
      available: boolean;
      active_shift_ids: string[];
      min: number;
      max: number | null;
      closures: { from: string; to: string }[];
    }[];
    months: { month: string; status: 'draft' | 'published' | 'locked' }[];
    holidays: string[];
  };
  rows: {
    date: string[];
    employee: number[];
    shift: (number | null)[];
    workstation: (number | null)[];
    present: boolean[];
    absence: (string | null)[];
    creation: string[];
    hours: number[];
    night: boolean[];
    /** The Saturday of the weekend the day belongs to, or null. */
    weekend: (string | null)[];
    holiday: boolean[];
  };
}

/** One roster change notice, names resolved. */
export interface ChangeFact {
  id: string;
  created_at: string;
  date: string;
  employee_id: string;
  employee_name: string;
  workstation_before: string | null;
  workstation_after: string | null;
  workstation_before_name: string | null;
  workstation_after_name: string | null;
  shift_before: string | null;
  shift_after: string | null;
  absence_before: string | null;
  absence_after: string | null;
  source: string;
  actor: string | null;
  reason: string | null;
  acknowledged_at: string | null;
}

/** Audit entries of one UTC day, action, item type and actor. */
export interface AuditActivityGroup {
  day: string;
  action: string;
  entity_type: string | null;
  actor: string | null;
  count: number;
}

export interface AuditActivity {
  from_date: string;
  to_date: string;
  total: number;
  groups: AuditActivityGroup[];
}

/** One planning task and how it ended — never the plan itself. */
export interface PlanningRun {
  id: string;
  created_at: string;
  finished_at: string | null;
  source: 'manual' | 'auto';
  status: 'scheduled' | 'done' | 'error';
  error_message: string | null;
  result_id: string | null;
  period_start: string | null;
  period_end: string | null;
  solver_status: string | null;
  has_message: boolean;
  /** Automatic runs: whether the plan became the roster; null otherwise. */
  taken_as_roster: boolean | null;
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

  /** The confirmed roster of the period as facts, for the Analytics page (planners and admins). */
  getRosterFacts(fromDate: string, toDate: string): Observable<RosterFactsPayload> {
    return this.http.get<RosterFactsPayload>(`${this.apiUrl}/analysis/roster-facts`, { params: period(fromDate, toDate) });
  }

  /** Roster change notices created in the period. */
  getChangeFacts(fromDate: string, toDate: string): Observable<ChangeFact[]> {
    return this.http
      .get<{ notices: ChangeFact[] }>(`${this.apiUrl}/analysis/change-facts`, { params: period(fromDate, toDate) })
      .pipe(map((r) => r.notices));
  }

  /** Audit entries of the period, counted per day, action, item type and actor. */
  getAuditActivity(fromDate: string, toDate: string): Observable<AuditActivity> {
    return this.http.get<AuditActivity>(`${this.apiUrl}/analysis/audit-activity`, { params: period(fromDate, toDate) });
  }

  /** Planning runs created in the period. */
  getPlanningRuns(fromDate: string, toDate: string): Observable<PlanningRun[]> {
    return this.http
      .get<{ runs: PlanningRun[] }>(`${this.apiUrl}/analysis/planning-runs`, { params: period(fromDate, toDate) })
      .pipe(map((r) => r.runs));
  }
}

function period(fromDate: string, toDate: string): HttpParams {
  return new HttpParams().set('from_date', fromDate).set('to_date', toDate);
}
