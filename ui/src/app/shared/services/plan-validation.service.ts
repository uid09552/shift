import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** One rule the plan breaks, with every breach of it collapsed into one entry. */
export interface ValidationFinding {
  rule: string;
  severity: 'error' | 'warning';
  title: string;
  detail: string;
  count: number;
  examples: string[];
  /** Breaches beyond the listed examples. */
  more?: number;
}

export interface ValidationStats {
  days: number;
  employees_in_scope: number;
  employees_scheduled: number;
  assignments: number;
  hours_planned: number;
  wishes_total: number;
  wishes_fulfilled: number;
}

export interface PlanValidationReport {
  result_id: string;
  /** `valid` — nothing found; `issues` — soft warnings only; `invalid` — hard rules broken. */
  verdict: 'valid' | 'issues' | 'invalid';
  planning_period: { start_date: string; end_date: string };
  solver_status?: string;
  objective_value?: number;
  constraints: Record<string, number | null>;
  stats: ValidationStats;
  error_count: number;
  warning_count: number;
  findings: ValidationFinding[];
  /** The verdict in one sentence, written without the model. */
  headline: string;
  /** The assistant's written review of the findings (markdown). */
  summary: string;
}

/**
 * Has the assistant check a proposed plan before it is confirmed.
 *
 * The endpoint lives on the agent (`agent/shift_agent/agent/server.py`), not the
 * Rust backend: the rules are re-derived there from the same `preparePlan`
 * payload the optimizer was given, and the assistant writes up what was found.
 * The gateway maps `/agent/*` onto the agent's own `/api/v1/*`.
 */
@Injectable({
  providedIn: 'root',
})
export class PlanValidationService {
  private readonly apiUrl = '/agent';

  constructor(private http: HttpClient) {}

  validatePlan(resultId: string): Observable<PlanValidationReport> {
    return this.http.post<PlanValidationReport>(`${this.apiUrl}/plan/validate`, {
      result_id: resultId,
    });
  }
}
