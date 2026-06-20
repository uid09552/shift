import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Workstation {
  id: string;
  name: string;
  available: boolean;
  active_shift_ids: string[];
}

export interface Capability {
  id: string;
  name: string;
}

export interface WorkstationDetail extends Workstation {
  required_capabilities: Capability[];
}

export interface CreateWorkstationRequest {
  name: string;
  available: boolean;
  active_shift_ids?: string[];
}

export interface UpdateWorkstationRequest {
  name?: string;
  available?: boolean;
  active_shift_ids?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class WorkstationService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  getWorkstations(): Observable<Workstation[]> {
    return this.http.get<Workstation[]>(`${this.apiUrl}/workstations`);
  }

  getWorkstationById(workstationId: string): Observable<WorkstationDetail> {
    return this.http.get<WorkstationDetail>(`${this.apiUrl}/workstations/${workstationId}`);
  }

  createWorkstation(request: CreateWorkstationRequest): Observable<Workstation> {
    return this.http.post<Workstation>(`${this.apiUrl}/workstations`, request);
  }

  updateWorkstation(workstationId: string, request: UpdateWorkstationRequest): Observable<Workstation> {
    return this.http.put<Workstation>(`${this.apiUrl}/workstations/${workstationId}`, request);
  }

  setAvailability(workstationId: string, available: boolean, active_shift_ids?: string[]): Observable<Workstation> {
    return this.http.put<Workstation>(`${this.apiUrl}/workstations/${workstationId}/availability`, {
      available,
      active_shift_ids: active_shift_ids ?? [],
    });
  }

  getRequiredCapabilities(workstationId: string): Observable<Capability[]> {
    return this.http.get<Capability[]>(`${this.apiUrl}/workstations/${workstationId}/required-capabilities`);
  }

  addRequiredCapability(workstationId: string, capabilityId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/workstations/${workstationId}/required-capabilities`, {
      capability_id: capabilityId,
    });
  }

  removeRequiredCapability(workstationId: string, capabilityId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/workstations/${workstationId}/required-capabilities/${capabilityId}`);
  }

  deleteWorkstation(workstationId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/workstations/${workstationId}`);
  }
}
