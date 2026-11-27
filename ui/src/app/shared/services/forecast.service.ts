import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CapabilityForecast {
  id: string;
  name: string;
  required_hours: number;
  available_hours: number;
  /** required − available: > 0 is a shortfall. */
  gap_hours: number;
}

export interface MonthForecast {
  month: string;
  days: number;
  contracted_hours: number;
  absence_hours: number;
  available_hours: number;
  required_hours: number;
  gap_hours: number;
  workstations: { id: string; name: string; required_hours: number }[];
  capabilities: CapabilityForecast[];
}

export interface CapacityForecast {
  from: string;
  months: MonthForecast[];
}

@Injectable({ providedIn: 'root' })
export class ForecastService {
  constructor(private http: HttpClient) {}

  /** Contracted hours minus recorded absences against what the workstations need, per month. */
  get(months: number, from?: string): Observable<CapacityForecast> {
    const params: Record<string, string> = { months: String(months) };
    if (from) params['from'] = from;
    return this.http.get<CapacityForecast>('/api/v1/analysis/capacity-forecast', { params });
  }
}
