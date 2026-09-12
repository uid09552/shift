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

/** One thing the repair did to the plan. */
export interface PlanFixChange {
  /** `cleared` — removed; `moved` — same day, different shift/station; `added` — newly staffed. */
  action: 'cleared' | 'moved' | 'added';
  /** The rule it answers — a validation finding's `rule`, or `instruction` / `fill`. */
  rule: string;
  employee_id: string;
  date: string;
  before: string | null;
  after: string | null;
  /** The change in one readable line, names and dates filled in. */
  text: string;
}

export interface PlanFixReport {
  result_id: string;
  /** `repair` — local moves; `resolve` — the whole period re-solved by the optimizer. */
  strategy: 'repair' | 'resolve';
  persisted: boolean;
  /** What the planner typed, and what the assistant made of it. */
  instruction: string;
  understood: string;
  /** The verdict before the fix — the report the Verify button had shown. */
  before: {
    verdict: 'valid' | 'issues' | 'invalid';
    error_count: number;
    warning_count: number;
    findings: ValidationFinding[];
    stats: ValidationStats;
  };
  /**
   * The full check of the repaired plan — the same shape a verification
   * returns, minus `summary`: the repair's own write-up covers it.
   */
  after: Omit<PlanValidationReport, 'summary'>;
  changes: PlanFixChange[];
  change_count: number | null;
  /** Instructions that could not be carried out, each with its reason. */
  rejected: string[];
  /** Anything the solver reported about a re-solve (dropped locks, and so on). */
  optimizer_note: string | null;
  headline: string;
  /** The assistant's written report of the repair (markdown). */
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

  /**
   * Has the assistant fix the plan and save the result.
   *
   * `instruction` is whatever the planner typed next to the button, in their
   * own words — the assistant turns it into concrete moves, each of which is
   * refused if it would break a rule. `strategy` is `repair` for local moves
   * (seconds) or `resolve` to hand the period back to the optimizer (minutes),
   * which keeps only what the instruction pinned.
   *
   * The repaired plan is written to the same result, so the page has to reload
   * it afterwards.
   */
  fixPlan(
    resultId: string,
    instruction: string,
    strategy: 'repair' | 'resolve' = 'repair',
  ): Observable<PlanFixReport> {
    return this.http.post<PlanFixReport>(`${this.apiUrl}/plan/fix`, {
      result_id: resultId,
      instruction,
      strategy,
    });
  }
}
