import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, map } from 'rxjs';

export interface Employee {
  id: string;
  name: string;
  email: string;
  monthly_working_hours: number;
  available_shifts: Shift[];
  capabilities: Capability[];
}

export interface Capability {
  id: string;
  name: string;
}

export interface Shift {
  id: string;
  name: string;
}

export interface EmployeeProfile {
  id: string;
  name: string;
  email: string;
  monthly_working_hours: number;
  shifts: string[];
  capabilities: string[];
}

export interface PaginatedEmployeeResponse {
  data: Employee[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateEmployeeRequest {
  name: string;
  email: string;
  monthly_working_hours: number;
}

export interface AddCapabilityRequest {
  capability_id: string;
}

export interface AddAvailableShiftRequest {
  shift_id: string;
}

@Injectable({
  providedIn: 'root',
})
export class EmployeeService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  getEmployeeProfiles(limit: number, offset: number): Observable<PaginatedEmployeeResponse> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<PaginatedEmployeeResponse>(`${this.apiUrl}/employees`, { params });
  }

  getEmployeeDetail(id: string): Observable<EmployeeProfile> {
    return forkJoin({
      employee: this.http.get<Employee>(`${this.apiUrl}/employees/${id}`),
      capabilities: this.http.get<Capability[]>(`${this.apiUrl}/employees/${id}/capabilities`),
      shifts: this.http.get<Shift[]>(`${this.apiUrl}/employees/${id}/available-shifts`),
    }).pipe(
      map(({ employee, capabilities, shifts }) => ({
        id: employee.id,
        name: employee.name,
        email: employee.email,
        monthly_working_hours: employee.monthly_working_hours,
        capabilities: capabilities.map((c) => c.name),
        shifts: shifts.map((s) => s.name),
      }))
    );
  }

  createEmployee(request: CreateEmployeeRequest): Observable<Employee> {
    return this.http.post<Employee>(`${this.apiUrl}/employees`, request);
  }

  updateEmployee(id: string, body: { name?: string; email?: string; monthly_working_hours?: number }): Observable<Employee> {
    return this.http.put<Employee>(`${this.apiUrl}/employees/${id}`, body);
  }

  addEmployeeCapability(employeeId: string, request: AddCapabilityRequest): Observable<any> {
    return this.http.post(`${this.apiUrl}/employees/${employeeId}/capabilities`, request);
  }

  addEmployeeAvailableShift(employeeId: string, request: AddAvailableShiftRequest): Observable<any> {
    return this.http.post(`${this.apiUrl}/employees/${employeeId}/available-shifts`, request);
  }

  deleteEmployee(employeeId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/employees/${employeeId}`);
  }

  removeEmployeeCapability(employeeId: string, capabilityId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/employees/${employeeId}/capabilities/${capabilityId}`);
  }

  removeEmployeeAvailableShift(employeeId: string, shiftId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/employees/${employeeId}/available-shifts/${shiftId}`);
  }
}
