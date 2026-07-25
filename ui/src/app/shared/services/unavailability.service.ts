import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Unavailability {
  id: string;
  employee_id: string;
  unavailable_date: string;
  shift_id?: string;
  is_soft_preference?: boolean;
}

export interface CreateUnavailabilityRequest {
  employee_id: string;
  unavailable_date: string;
  shift_id?: string;
  is_soft_preference?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class UnavailabilityService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  getUnavailabilities(employeeId?: string): Observable<Unavailability[]> {
    let params = new HttpParams();
    if (employeeId) {
      params = params.set('employee_id', employeeId);
    }
    return this.http.get<Unavailability[]>(`${this.apiUrl}/unavailabilities`, { params });
  }

  getUnavailability(id: string): Observable<Unavailability> {
    return this.http.get<Unavailability>(`${this.apiUrl}/unavailabilities/${id}`);
  }

  createUnavailability(request: CreateUnavailabilityRequest): Observable<Unavailability> {
    return this.http.post<Unavailability>(`${this.apiUrl}/unavailabilities`, request);
  }

  deleteUnavailability(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/unavailabilities/${id}`);
  }
}
