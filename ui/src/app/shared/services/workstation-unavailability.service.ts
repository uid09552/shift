import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

@Injectable({
  providedIn: 'root',
})
export class WorkstationUnavailabilityService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

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
