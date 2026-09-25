import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** The shift that needs covering: the absent person's cell in the confirmed roster. */
export interface ReplacementSlot {
  date: string;
  employee_id: string;
  employee_name: string;
  plan_id: string;
  shift_id: string;
  shift_name: string;
  workstation_id: string | null;
  workstation_name: string | null;
  hours: number;
  /** Who is still on that shift (at that workstation) without the absent person. */
  staffed_without: number;
  min_employees: number | null;
  max_employees: number | null;
}

/** A colleague who may legally take the slot, with what the ranking weighed. */
export interface ReplacementCandidate {
  rank: number;
  employee_id: string;
  name: string;
  month_hours: number;
  target_hours: number | null;
  hours_below_target: number;
  last_shift: string | null;
  /** Hours between the end of their last shift and the start of this one; null if none in view. */
  rest_hours: number | null;
  wished: boolean;
  preferred_day_off: boolean;
  notes: string[];
  /** Their "free" row for that day, which the new shift replaces (one row per person and day). */
  free_plan_id: string | null;
}

export interface ReplacementUnavailable {
  employee_id: string;
  name: string;
  /** The rule that rules them out, in words. */
  reason: string;
}

export interface ReplacementAnswer {
  slot: ReplacementSlot;
  candidates: ReplacementCandidate[];
  unavailable: ReplacementUnavailable[];
}

/**
 * Short-notice replacement: who can take an absent person's shift. Served by
 * the agent (`agent/shift_agent/agent/replacement.py`), which checks every
 * colleague against the same rules as the plan repair. Read-only — the caller
 * records the absence and the replacement through the confirmed-plan endpoints.
 */
@Injectable({ providedIn: 'root' })
export class ReplacementService {
  private readonly apiUrl = '/agent';

  constructor(private http: HttpClient) {}

  findReplacements(employeeId: string, date: string): Observable<ReplacementAnswer> {
    return this.http.post<ReplacementAnswer>(`${this.apiUrl}/roster/replacements`, {
      employee_id: employeeId,
      date,
    });
  }
}
