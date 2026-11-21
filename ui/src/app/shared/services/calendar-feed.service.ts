import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CalendarFeed {
  /** Null when no employee matches the account: there is no roster to subscribe to. */
  employee_id: string | null;
  active: boolean;
  created_at: string | null;
  last_fetched_at: string | null;
  /** Only in the answer that made the link — it is never shown again. */
  token?: string;
  path?: string;
}

/** The caller's own calendar feed link (iCal): make, replace, remove. */
@Injectable({ providedIn: 'root' })
export class CalendarFeedService {
  private readonly apiUrl = '/api/v1/calendar-feed';

  constructor(private http: HttpClient) {}

  get(): Observable<CalendarFeed> {
    return this.http.get<CalendarFeed>(this.apiUrl);
  }

  /** A new link; any older one stops working. */
  create(): Observable<CalendarFeed> {
    return this.http.post<CalendarFeed>(this.apiUrl, {});
  }

  remove(): Observable<CalendarFeed> {
    return this.http.delete<CalendarFeed>(this.apiUrl);
  }
}

/** The feed's full address, and the same as `webcal://` for one-tap subscribing. */
export function feedUrls(path: string, origin: string): { https: string; webcal: string } {
  const https = new URL(path, origin).toString();
  return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}
