import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ImportColumnMapping, ImportPreview, importFormData } from '../components/import-dialog/import.models';

export interface Capability {
  id: string;
  name: string;
  level: number;
  skill_group: string | null;
}

export interface CreateCapabilityRequest {
  name: string;
  level?: number;
  skill_group?: string | null;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
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

  updateCapability(id: string, request: CreateCapabilityRequest): Observable<Capability> {
    return this.http.put<Capability>(`${this.apiUrl}/${id}`, request);
  }

  deleteCapability(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  downloadTemplate(): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/template`, { responseType: 'blob' });
  }

  /** How `file` would be read, nothing written. `sheet` picks another sheet of the workbook. */
  previewImport(file: File, sheet?: string): Observable<ImportPreview> {
    return this.http.post<ImportPreview>(`${this.apiUrl}/import/preview`, importFormData(file, { sheet }));
  }

  /** Imports `file`; `mapping` is what the user assigned, detection is used without it. */
  importFromFile(file: File, mapping?: ImportColumnMapping): Observable<ImportResult> {
    const parts = { mapping: mapping && JSON.stringify(mapping) };
    return this.http.post<ImportResult>(`${this.apiUrl}/import`, importFormData(file, parts));
  }
}
