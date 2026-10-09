import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/** A month of the confirmed roster: draft → published → locked (see backend roster_guard). */
export type MonthStatus = 'draft' | 'published' | 'locked';

export interface RosterMonth {
  /** YYYY-MM */
  month: string;
  status: MonthStatus;
  published_at: string | null;
  published_by: string | null;
  locked_at: string | null;
  locked_by: string | null;
  /** Unlocked by an admin: stays published after its last day. */
  reopened: boolean;
  /** YYYY-MM-DD — first day minus publish_lead_days. */
  publish_by: string;
  /** Only for a draft month that is due or overdue. */
  deadline: 'due' | 'overdue' | null;
}

export interface RosterEntryView {
  shift_id: string | null;
  shift_name: string | null;
  workstation_id: string | null;
  workstation_name: string | null;
  absence_type: string | null;
}

export type ChangeSource = 'manual' | 'take_as_plan' | 'absence' | 'swap' | 'replacement';

export interface RosterChangeNotice {
  id: string;
  employee_id: string;
  employee_name: string | null;
  date: string;
  before: RosterEntryView | null;
  after: RosterEntryView | null;
  source: ChangeSource;
  actor: string | null;
  reason: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface NoticeFilter {
  employee_id?: string;
  from_date?: string;
  to_date?: string;
  acknowledged?: boolean;
}

export type MonthAction = 'publish' | 'unpublish' | 'unlock' | 'lock';

@Injectable({ providedIn: 'root' })
export class RosterService {
  private readonly apiUrl = '/api/v1';

  constructor(private http: HttpClient) {}

  /** `from` / `to` as YYYY-MM; the backend defaults to this month and the two after it. */
  listMonths(from?: string, to?: string): Observable<RosterMonth[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<RosterMonth[]>(`${this.apiUrl}/roster-months`, { params });
  }

  /**
   * Unpublish and unlock need a reason: the backend answers 428 without one,
   * and the reason-required interceptor asks for it.
   */
  changeMonth(month: string, action: MonthAction): Observable<RosterMonth> {
    return this.http.post<RosterMonth>(`${this.apiUrl}/roster-months/${month}/${action}`, null);
  }

  listNotices(filter: NoticeFilter = {}): Observable<RosterChangeNotice[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<RosterChangeNotice[]>(`${this.apiUrl}/roster-change-notices`, { params });
  }

  unreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.apiUrl}/roster-change-notices/unread-count`);
  }

  /** The caller's own notices — `ids`, or all unacknowledged ones. */
  acknowledge(ids?: string[]): Observable<{ acknowledged: number }> {
    return this.http.post<{ acknowledged: number }>(
      `${this.apiUrl}/roster-change-notices/acknowledge`,
      ids ? { ids } : {},
    );
  }
}
