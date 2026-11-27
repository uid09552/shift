import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Headcount a workstation needs per hour of one weekday (0 = Monday … 6 = Sunday, holidays too). */
export interface DemandDay {
  weekday: number;
  /** 24 headcounts: 00–01, 01–02, … 23–24. */
  hours: number[];
}

export interface WorkstationDemand {
  workstation_id: string;
  weekdays: DemandDay[];
}

@Injectable({ providedIn: 'root' })
export class DemandService {
  constructor(private http: HttpClient) {}

  all(): Observable<WorkstationDemand[]> {
    return this.http.get<WorkstationDemand[]>('/api/v1/workstation-demand');
  }

  get(workstationId: string): Observable<WorkstationDemand> {
    return this.http.get<WorkstationDemand>(`/api/v1/workstations/${workstationId}/demand`);
  }

  /** Replaces the curves; all-zero days are dropped (no curve that day). */
  save(workstationId: string, weekdays: DemandDay[]): Observable<WorkstationDemand> {
    return this.http.put<WorkstationDemand>(`/api/v1/workstations/${workstationId}/demand`, { weekdays });
  }
}
