import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Pages that keep saved views; the backend refuses any other. */
export type SavedViewPage = 'schedule';

/** A named filter set; what `filters` holds is the page's business. */
export interface SavedView<F = Record<string, unknown>> {
  id: string;
  page: SavedViewPage;
  name: string;
  filters: F;
  /** Offered to everyone in the organization (set by planners and admins). */
  shared: boolean;
  /** The caller's own view; someone else's can only be shared. */
  mine: boolean;
  owner_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedViewList<F = Record<string, unknown>> {
  page: SavedViewPage;
  views: SavedView<F>[];
  /** What the page opens with for the caller, if anything. */
  default_view_id: string | null;
  /** The view the caller applied last. */
  last_view_id: string | null;
}

export interface SavedViewPreferences {
  page: SavedViewPage;
  default_view_id: string | null;
  last_view_id: string | null;
}

/** The caller's saved views of a page, kept on the server so they follow them across devices. */
@Injectable({ providedIn: 'root' })
export class SavedViewService {
  private readonly apiUrl = '/api/v1/saved-views';

  constructor(private http: HttpClient) {}

  list<F>(page: SavedViewPage): Observable<SavedViewList<F>> {
    return this.http.get<SavedViewList<F>>(this.apiUrl, { params: { page } });
  }

  create<F>(page: SavedViewPage, name: string, filters: F, shared = false): Observable<SavedView<F>> {
    return this.http.post<SavedView<F>>(this.apiUrl, { page, name, filters, shared });
  }

  update<F>(id: string, body: { name?: string; filters?: F; shared?: boolean }): Observable<SavedView<F>> {
    return this.http.put<SavedView<F>>(`${this.apiUrl}/${id}`, body);
  }

  remove(id: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  /** Replaces both choices; `null` clears one. */
  setPreferences(prefs: SavedViewPreferences): Observable<SavedViewPreferences> {
    return this.http.put<SavedViewPreferences>(`${this.apiUrl}/preferences`, prefs);
  }
}
