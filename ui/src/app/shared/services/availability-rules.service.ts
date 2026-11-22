import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type AvailabilityKind = 'only_shifts' | 'not_shifts' | 'only_weekdays' | 'not_weekdays';

/** A standing availability rule: "only early shifts", "never on Wednesdays", fixed days. */
export interface AvailabilityRule {
  id: string;
  employee_id: string;
  kind: AvailabilityKind;
  shift_ids: string[];
  /** 0 = Monday … 6 = Sunday. */
  weekdays: number[];
  mode: 'hard' | 'soft';
  valid_from: string | null;
  valid_until: string | null;
  note: string | null;
  created_at: string;
}

export type NewAvailabilityRule = Omit<AvailabilityRule, 'id' | 'employee_id' | 'created_at'>;

/** A capability that has lapsed or lapses soon, for the planners' list. */
export interface CapabilityExpiry {
  employee_id: string;
  employee_name: string;
  capability_id: string;
  capability_name: string;
  valid_until: string;
  days_left: number;
  expired: boolean;
}

/** An employee's held capability with its last valid day. */
export interface HeldCapability {
  id: string;
  name: string;
  level: number;
  skill_group: string | null;
  valid_until?: string | null;
}

/** Standing availability and capability expiry — what an employee can be planned for. */
@Injectable({ providedIn: 'root' })
export class AvailabilityRulesService {
  constructor(private http: HttpClient) {}

  list(employeeId: string): Observable<AvailabilityRule[]> {
    return this.http.get<AvailabilityRule[]>(`/api/v1/employees/${employeeId}/availability-rules`);
  }

  create(employeeId: string, rule: NewAvailabilityRule): Observable<AvailabilityRule> {
    return this.http.post<AvailabilityRule>(`/api/v1/employees/${employeeId}/availability-rules`, rule);
  }

  remove(employeeId: string, ruleId: string): Observable<unknown> {
    return this.http.delete(`/api/v1/employees/${employeeId}/availability-rules/${ruleId}`);
  }

  heldCapabilities(employeeId: string): Observable<HeldCapability[]> {
    return this.http.get<HeldCapability[]>(`/api/v1/employees/${employeeId}/capabilities`);
  }

  /** The last valid day of a capability the employee holds; null: it does not lapse. */
  setExpiry(employeeId: string, capabilityId: string, validUntil: string | null): Observable<unknown> {
    return this.http.put(`/api/v1/employees/${employeeId}/capabilities/${capabilityId}`, { valid_until: validUntil });
  }

  /** Lapsed, or lapsing within `days`. Planners and admins only. */
  expiries(days = 60): Observable<CapabilityExpiry[]> {
    return this.http.get<CapabilityExpiry[]>('/api/v1/capability-expiries', { params: new HttpParams().set('within_days', days) });
  }
}
