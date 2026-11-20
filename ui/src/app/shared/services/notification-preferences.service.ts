import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type NotificationEvent =
  | 'roster_published'
  | 'shift_changed'
  | 'swap_update'
  | 'leave_update'
  | 'open_shift_offered';

export interface NotificationPreferences {
  /** Null when no employee matches the account: there is nothing to set. */
  employee_id: string | null;
  email_enabled: boolean;
  muted_events: NotificationEvent[];
  /** Every event there is. */
  events: NotificationEvent[];
  /** False while the deployment has no mail server: nothing is sent whatever is chosen. */
  email_configured: boolean;
}

/** The caller's own e-mail notification choices: the channel, and single events. */
@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private readonly apiUrl = '/api/v1/notification-preferences';

  constructor(private http: HttpClient) {}

  get(): Observable<NotificationPreferences> {
    return this.http.get<NotificationPreferences>(this.apiUrl);
  }

  save(emailEnabled: boolean, mutedEvents: NotificationEvent[]): Observable<NotificationPreferences> {
    return this.http.put<NotificationPreferences>(this.apiUrl, { email_enabled: emailEnabled, muted_events: mutedEvents });
  }
}
