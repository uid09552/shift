import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Whether — and when — employees may place shift wishes themselves.
 * Mirrors `WishMode` in the backend (src/repository/domain.rs).
 */
export type WishMode = 'enabled' | 'disabled' | 'date_range';

export interface WishSettings {
  mode: WishMode;
  /** Inclusive; only meaningful while mode is `date_range`. */
  window_start: string | null;
  /** Inclusive; only meaningful while mode is `date_range`. */
  window_end: string | null;
  updated_at: string;
}

export type UpdateWishSettingsRequest = Omit<WishSettings, 'updated_at'>;

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
