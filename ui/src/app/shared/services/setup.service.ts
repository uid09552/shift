import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type SetupStepId = 'shifts' | 'capabilities' | 'workstations' | 'employees' | 'planner_settings' | 'first_plan';

export interface SetupStep {
  id: SetupStepId;
  count: number;
  done: boolean;
}

export interface SetupStatus {
  steps: SetupStep[];
  complete: boolean;
  /** The organization is empty, so sample data may go in. */
  sample_data_available: boolean;
}

/** The first-run checklist (`/setup-status`) and sample data for an empty organization. */
@Injectable({ providedIn: 'root' })
export class SetupService {
  constructor(private http: HttpClient) {}

  status(): Observable<SetupStatus> {
    return this.http.get<SetupStatus>('/api/v1/setup-status');
  }

  /** `shift-admin` only; 409 once the organization has any data. */
  loadSampleData(): Observable<SetupStatus> {
    return this.http.post<SetupStatus>('/api/v1/setup/sample-data', {});
  }
}

const DISMISSED_KEY = 'setup.checklistDismissed';

/** Whether the admin hid the checklist from the overview (per browser; the Setup page reopens it). */
export function checklistDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setChecklistDismissed(dismissed: boolean): void {
  try {
    if (dismissed) localStorage.setItem(DISMISSED_KEY, '1');
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Private mode or blocked storage: the banner simply shows again next time.
  }
}

/** Where each step is done, in the order the planner needs them. */
export const SETUP_STEP_LINKS: Record<SetupStepId, { path: string; newPath?: string }> = {
  shifts: { path: '/shifts', newPath: '/shifts/new' },
  capabilities: { path: '/capabilities', newPath: '/capabilities/new' },
  workstations: { path: '/workstations', newPath: '/workstations/new' },
  employees: { path: '/user-profiles', newPath: '/user-profiles/new' },
  planner_settings: { path: '/planner-settings' },
  first_plan: { path: '/scheduler' },
};
