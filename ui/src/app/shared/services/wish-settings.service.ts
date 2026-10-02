import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Whether — and when — employees may place shift wishes themselves.
 * Mirrors `WishMode` in the backend (src/repository/domain.rs).
 */
export type WishMode = 'enabled' | 'disabled' | 'date_range';

export type ScheduleUnit = 'days' | 'weeks' | 'months';

/** Recurring open/close rule, evaluated by a background job in UTC. */
export interface WishSchedule {
  enabled: boolean;
  unit: ScheduleUnit;
  /** Every N days / weeks / months. */
  interval: number;
  /** 0 = Monday … 6 = Sunday; used by `weeks`. */
  weekday: number;
  /** 1–31, clamped to the month's last day; used by `months`. */
  day_of_month: number;
  /** HH:MM:SS (UTC). */
  time: string;
  /** How long the window stays open from each occurrence. */
  open_days: number;
  start_date: string | null;
}

export interface WishScheduleStatus extends WishSchedule {
  next_change_at: string | null;
  next_change_opens: boolean | null;
}

export interface WishSettings {
  mode: WishMode;
  /** Inclusive; only meaningful while mode is `date_range`. */
  window_start: string | null;
  /** Inclusive; only meaningful while mode is `date_range`. */
  window_end: string | null;
  schedule: WishScheduleStatus;
  updated_at: string;
}

export interface UpdateWishSettingsRequest {
  mode: WishMode;
  window_start: string | null;
  window_end: string | null;
  schedule: WishSchedule;
}

/**
 * The tenant's shift-wish window. Readable by everyone — the calendar needs it to
 * decide whether to offer the wish picker — but only `shift-admin` may write it.
 */
@Injectable({
  providedIn: 'root',
})
export class WishSettingsService {
  private readonly apiUrl = '/api/v1/wish-settings';

  constructor(private http: HttpClient) {}

  getWishSettings(): Observable<WishSettings> {
    return this.http.get<WishSettings>(this.apiUrl);
  }

  updateWishSettings(settings: UpdateWishSettingsRequest): Observable<WishSettings> {
    return this.http.put<WishSettings>(this.apiUrl, settings);
  }
}

/**
 * Whether a wish may be placed for `date` (YYYY-MM-DD) under `settings`.
 * Mirrors `WishSettingsDomain::allows_wish_on` — the backend decides, this only
 * keeps the UI from offering what would be refused.
 */
export function wishAllowedOn(settings: WishSettings | null, date: string): boolean {
  if (!settings) {
    return true; // Settings not loaded yet — let the backend have the last word.
  }
  switch (settings.mode) {
    case 'enabled':
      return true;
    case 'disabled':
      return false;
    case 'date_range':
      return (
        !!settings.window_start &&
        !!settings.window_end &&
        date >= settings.window_start &&
        date <= settings.window_end
      );
  }
}
