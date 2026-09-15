import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface WorkstationUnavailability {
  id: string;
  workstation_id: string;
  unavailable_from: string;
  unavailable_to: string;
}

export interface CreateWorkstationUnavailabilityRequest {
  unavailable_from: string;
  unavailable_to: string;
}

/** Whether one of the closures covers `date` (YYYY-MM-DD; ISO dates compare as strings). */
export function isClosedOn(closures: WorkstationUnavailability[], date: string): boolean {
  return closures.some((c) => c.unavailable_from <= date && date <= c.unavailable_to);
}

@Injectable({
  providedIn: 'root',
})
export class WorkstationUnavailabilityService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  /** Every workstation's closures overlapping the range; either bound may be left out. */
  getAllUnavailabilities(fromDate?: string, toDate?: string): Observable<WorkstationUnavailability[]> {
    let params = new HttpParams();
    if (fromDate) params = params.set('from_date', fromDate);
    if (toDate) params = params.set('to_date', toDate);
    return this.http.get<WorkstationUnavailability[]>(`${this.apiUrl}/workstation-unavailabilities`, { params });
  }

  getUnavailabilities(workstationId: string): Observable<WorkstationUnavailability[]> {
    return this.http.get<WorkstationUnavailability[]>(`${this.apiUrl}/workstations/${workstationId}/unavailabilities`);
  }

  createUnavailability(workstationId: string, request: CreateWorkstationUnavailabilityRequest): Observable<WorkstationUnavailability> {
    return this.http.post<WorkstationUnavailability>(`${this.apiUrl}/workstations/${workstationId}/unavailabilities`, request);
  }

  deleteUnavailability(workstationId: string, unavailabilityId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/workstations/${workstationId}/unavailabilities/${unavailabilityId}`);
  }
}
