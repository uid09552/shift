import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AuditLog {
  id: string;
  actor: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: string | null;
  created_at: string;
}

export interface PaginatedAuditLogsResponse {
  data: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListAuditLogsParams {
  action?: string;
  entity_type?: string;
  entity_id?: string;
  /** Any part of who did it, case-insensitive. */
  actor?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

/** What occurs in the log — the values the audit log page's filters offer. */
export interface AuditFacets {
  actions: string[];
  entity_types: string[];
  actors: string[];
}

@Injectable({
  providedIn: 'root',
})
export class AuditLogService {
  private readonly apiUrl = '/api/v1/audit-logs';

  constructor(private http: HttpClient) {}

  listAuditLogs(params: ListAuditLogsParams = {}): Observable<PaginatedAuditLogsResponse> {
    let httpParams = new HttpParams();
    if (params.action) httpParams = httpParams.set('action', params.action);
    if (params.entity_type) httpParams = httpParams.set('entity_type', params.entity_type);
    if (params.entity_id) httpParams = httpParams.set('entity_id', params.entity_id);
    if (params.actor) httpParams = httpParams.set('actor', params.actor);
    if (params.from_date) httpParams = httpParams.set('from_date', params.from_date);
    if (params.to_date) httpParams = httpParams.set('to_date', params.to_date);
    if (params.limit !== undefined) httpParams = httpParams.set('limit', params.limit);
    if (params.offset !== undefined) httpParams = httpParams.set('offset', params.offset);
    return this.http.get<PaginatedAuditLogsResponse>(this.apiUrl, { params: httpParams });
  }

  getFacets(): Observable<AuditFacets> {
    return this.http.get<AuditFacets>(`${this.apiUrl}/facets`);
  }
}
