import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Capability {
  id: string;
  name: string;
}

export interface CreateCapabilityRequest {
  name: string;
}

@Injectable({
  providedIn: 'root',
})
export class CapabilityService {
  private apiUrl = '/api/v1/capabilities';

  constructor(private http: HttpClient) {}

  getCapabilities(): Observable<Capability[]> {
    return this.http.get<Capability[]>(this.apiUrl);
  }

  getCapabilityById(id: string): Observable<Capability> {
    return this.http.get<Capability>(`${this.apiUrl}/${id}`);
  }

  createCapability(request: CreateCapabilityRequest): Observable<Capability> {
    return this.http.post<Capability>(this.apiUrl, request);
  }

  deleteCapability(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
