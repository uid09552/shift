import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type RuleMode = 'hard' | 'soft';
export type SkillMixKind = 'at_least' | 'at_most';
export type PairingKind = 'mentor' | 'together' | 'apart';

/** Who has to be on a slot: per shift (or one shift), at one ward or summed over all. */
export interface SkillMixRule {
  id: string;
  kind: SkillMixKind;
  count: number;
  capability_id: string | null;
  skill_group: string | null;
  min_level: number | null;
  shift_id: string | null;
  workstation_id: string | null;
  mode: RuleMode;
  created_at: string;
}

export type NewSkillMixRule = Omit<SkillMixRule, 'id' | 'created_at'>;

/** Two people: a trainee (`employee_id`) beside their mentor, together, or apart. */
export interface PairingRule {
  id: string;
  kind: PairingKind;
  employee_id: string;
  partner_id: string;
  mode: RuleMode;
  created_at: string;
}

export type NewPairingRule = Omit<PairingRule, 'id' | 'created_at'>;

/** The ward's skill-mix and pairing rules. Planners and admins only. */
@Injectable({ providedIn: 'root' })
export class StaffingRulesService {
  constructor(private http: HttpClient) {}

  listSkillMix(): Observable<SkillMixRule[]> {
    return this.http.get<SkillMixRule[]>('/api/v1/skill-mix-rules');
  }

  createSkillMix(rule: NewSkillMixRule): Observable<SkillMixRule> {
    return this.http.post<SkillMixRule>('/api/v1/skill-mix-rules', rule);
  }

  deleteSkillMix(id: string): Observable<unknown> {
    return this.http.delete(`/api/v1/skill-mix-rules/${id}`);
  }

  listPairing(): Observable<PairingRule[]> {
    return this.http.get<PairingRule[]>('/api/v1/pairing-rules');
  }

  createPairing(rule: NewPairingRule): Observable<PairingRule> {
    return this.http.post<PairingRule>('/api/v1/pairing-rules', rule);
  }

  deletePairing(id: string): Observable<unknown> {
    return this.http.delete(`/api/v1/pairing-rules/${id}`);
  }
}
